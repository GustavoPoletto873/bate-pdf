import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TituloImportado } from '@/lib/planilha/importar';

// Banco num diretório temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-selecao-'));
delete (globalThis as { __lastroDb?: unknown }).__lastroDb;

let selecao: typeof import('./selecao');
let repo: typeof import('@/lib/repo');
let auditoria: typeof import('@/lib/auditoria');

beforeAll(async () => {
  selecao = await import('./selecao');
  repo = await import('@/lib/repo');
  auditoria = await import('@/lib/auditoria');
});

const titulo = (n: string): TituloImportado => ({
  linha_origem: 2, id_base_origem: null, numero_documento: n, sacado_nome: 'JOAO FICTICIO', sacado_documento: '12345678909',
  cedente_nome: 'EMPRESA FICTICIA', cedente_documento: '11222333000181', valor_total: '10.00', valor_aquisicao: null,
  data_emissao: null, data_vencimento: null, data_aquisicao: null, nome_fundo: null, cnpj_fundo: null, tipo_recebivel: null,
  chave_nfe: null, lados: {},
});

function base(nome: string, fundo: string, cnpj: string, data: string) {
  return repo.criarBase({
    nome, nome_fundo: fundo, cnpj_fundo: cnpj, data_referencia: data, administradora: null, origem: 'amostra',
    arquivo_origem: 'a.xlsx', titulos: [titulo('1'), titulo('2')],
  });
}

describe('Seleção de Auditoria', () => {
  test('período, busca, status e paginação', async () => {
    const a = await base('FIDC Açaí — 3º Trim/2026', 'FIDC Açaí', '11222333000181', '2026-09-30');
    const b = await base('FIDC Beta — 15/05/2026', 'FIDC Beta', '22333444000155', '2026-05-15');
    const c = await base('FIDC Gama — 2025', 'FIDC Gama', '33444555000166', '2025-12-31');
    // b em andamento (marcou um campo), c finalizada.
    const [p] = await repo.listarPendencias(b);
    await repo.salvarMarcacoes(b, [{ pendencia_id: p.pendencia_id, campo: 'numero_documento', valor: 'V' }]);
    await auditoria.definirFinalizada(c, true);

    expect(selecao.intervaloDoPeriodo({ tipo: 'trimestre', ano: '2026', trimestre: '3' })).toEqual(['2026-07-01', '2026-09-30']);
    expect(selecao.intervaloDoPeriodo({ tipo: 'data', data: '2026-05-15' })).toEqual(['2026-05-15', '2026-05-15']);
    expect(selecao.intervaloDoPeriodo({ tipo: 'trimestre', ano: '2026' })).toEqual(['2026-01-01', '2026-12-31']);
    expect(selecao.intervaloDoPeriodo({})).toBeNull();

    expect((await selecao.listarAuditorias({})).resumo).toEqual({ a_iniciar: 1, em_andamento: 1, finalizadas: 1, total: 3 });
    expect((await selecao.listarAuditorias({ ano: '2026' })).resumo.total).toBe(2);
    expect((await selecao.listarAuditorias({ tipo: 'trimestre', ano: '2026', trimestre: '3' })).itens.map((i) => i.base_id)).toEqual([a]);
    expect((await selecao.listarAuditorias({ tipo: 'data', data: '2026-05-15', status: 'em_andamento' })).itens.map((i) => i.base_id)).toEqual([b]);
    expect((await selecao.listarAuditorias({ busca: 'acai' })).itens.map((i) => i.base_id)).toEqual([a]);
    expect((await selecao.listarAuditorias({ busca: '22.333', status: 'em_andamento' })).itens.map((i) => i.base_id)).toEqual([b]);
    expect((await selecao.listarAuditorias({ busca: 'FIDC 2' })).resumo.total).toBe(0);
    const fin = await selecao.listarAuditorias({ status: 'finalizada' });
    expect(fin.itens[0]).toMatchObject({ base_id: c, titulos: 2, pendentes: { termo: 2, lastro: 2 }, status: 'finalizada' });
    expect(selecao.lerStatus('finalizadas')).toBe('finalizada');

    for (let i = 0; i < 17; i++) await base(`Extra ${i}`, 'FIDC Extra', '44555666000177', '2024-03-31');
    const pag2 = await selecao.listarAuditorias({ ano: '2024', pagina: 2 });
    expect(pag2).toMatchObject({ total: 17, paginas: 2, pagina: 2 });
    expect(pag2.itens).toHaveLength(1);

    const painel = await selecao.painelInicial();
    expect(painel.em_andamento.map((i) => i.base_id)).toEqual([b]);
    expect(painel.resumo.total).toBe(20);
  });
});
