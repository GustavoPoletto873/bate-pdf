import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TituloImportado } from '@/lib/planilha/importar';

// Banco num diretório temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-teste-'));
type Repo = typeof import('@/lib/repo');
let repo: Repo;
let dbMod: typeof import('@/lib/db');

const titulo = (n: string, sacado: string, cpf: string, valor: string): TituloImportado => ({
  linha_origem: 2, id_base_origem: null, numero_documento: n, sacado_nome: sacado, sacado_documento: cpf,
  cedente_nome: 'EMPRESA FICTICIA LTDA', cedente_documento: '11222333000181', valor_total: valor, valor_aquisicao: null,
  data_emissao: '2026-08-01', data_vencimento: '2026-10-10', data_aquisicao: '2026-09-15',
  nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', tipo_recebivel: 'CCB', chave_nfe: null, lados: {},
});

beforeAll(async () => {
  repo = await import('@/lib/repo');
  dbMod = await import('@/lib/db');
});

describe('fluxo do Bater PDF no banco local', () => {
  test('criar, marcar, travar com P, vincular, exportar e desfazer', () => {
    const id = repo.criarBase({
      nome: 'Teste', nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', data_referencia: '2026-09-30',
      administradora: null, origem: 'amostra', arquivo_origem: 'amostra.xlsx',
      titulos: [titulo('123456', 'JOAO DA SILVA', '12345678909', '1613.33'), titulo('123457', 'MARIA SOUZA', '98765432100', '2500.00')],
      lados: ['lastro'],
    });
    const base = repo.obterBase(id)!;
    expect(base.titulos).toBe(2);
    expect(base.pendentes).toEqual({ termo: 0, lastro: 2 });

    // PDF com texto (gravado direto: o indexador roda em outro processo).
    const pdf = repo.registrarPdf(id, { nome_arquivo: 'ccb.pdf', caminho_relativo: null, sha256: 'abc', tamanho: 10 });
    dbMod.db().prepare('INSERT INTO paginas (pdf_id, numero, texto, texto_normalizado) VALUES (?, 1, ?, ?)')
      .run(pdf.id, 'CÉDULA Nº 123456 JOÃO DA SILVA CPF 123.456.789-09', 'cedula nº 123456 joao da silva cpf 123.456.789-09');
    const busca = repo.buscarNosPdfs(id, 'JOÃO da Silva');
    expect(busca.resultados).toHaveLength(1);
    expect(busca.resultados[0].trecho.slice(...busca.resultados[0].destaque)).toBe('JOÃO DA SILVA');
    expect(repo.buscarNosPdfs(id, 'jo').motivo).toBe('termo_curto');

    const [p1] = repo.listarPendencias(id);
    // Campo em P bloqueia o vínculo.
    const recusa = repo.vincular(id, [{ pendencia_id: p1.pendencia_id, pdf_id: pdf.id }]);
    expect(recusa.vinculados).toBe(0);
    expect(recusa.recusados[0].motivo).toMatch(/8 campo\(s\) em P/);

    const campos = ['numero_documento', 'sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento', 'valor_total', 'data_vencimento'] as const;
    repo.salvarMarcacoes(id, [
      ...campos.map((campo) => ({ pendencia_id: p1.pendencia_id, campo, valor: 'V' as const })),
      { pendencia_id: p1.pendencia_id, campo: 'data_emissao', valor: 'D', valor_digitado: '2026-08-02' },
    ]);
    const ok = repo.vincular(id, [{ pendencia_id: p1.pendencia_id, pdf_id: pdf.id, pagina: 1 }]);
    expect(ok).toEqual({ vinculados: 1, recusados: [] });

    const exp = repo.linhasParaExportar(id, { incluirPendentes: false });
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ lado: 'lastro', status: 'V', pdf: { nome: 'ccb.pdf', pagina: 1 } });
    expect(exp[0].marcacoes.data_emissao).toBe('D');
    expect(exp[0].leitura).toMatchObject({ numero_documento: '123456', valor_total: '1613.33', data_emissao: '2026-08-02' });
    expect(repo.linhasParaExportar(id, { incluirPendentes: true })).toHaveLength(2);

    // Entrada do motor: só a pendência ainda aberta; o vínculo vira aprendizado.
    const entrada = repo.entradaDoMotor(id);
    expect(entrada.pendencias).toHaveLength(1);
    expect(entrada.pendencias[0]).toMatchObject({ tipo_documento: 'lastro', base_numero_documento: '123457' });
    expect(entrada.vinculos).toHaveLength(1);
    expect(entrada.paginas).toHaveLength(1);

    expect(repo.desvincular(id, [p1.pendencia_id])).toEqual({ desvinculados: 1 });
    expect(repo.obterBase(id)!.pendentes.lastro).toBe(2);
    repo.excluirBase(id);
    expect(repo.obterBase(id)).toBeNull();
  });
});
