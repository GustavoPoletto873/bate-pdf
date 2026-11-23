import { beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClienteGemini } from '@/lib/ia/cliente';
import type { Dependencias } from './processamento';

// Banco e pasta de dados temporários; dados fictícios; o Gemini é sempre um cliente falso.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-anexo-'));
delete process.env.GEMINI_API_KEY;

let repo: typeof import('@/lib/repo');
let dbMod: typeof import('@/lib/db');
let lotes: typeof import('./lotes');
let fila: typeof import('./fila');
let leituras: typeof import('@/lib/leituras');
let acomp: typeof import('./acompanhamento');
let vis: typeof import('./visualizar');

const CCB_LIDA = {
  NU_DOCUMENTO: 'CCB-900', NOME_CEDENTE: 'BANCO FICTICIO SA', DOC_CEDENTE: '11.222.333/0001-81', NOME_SACADO: 'JOÃO DA SILVA',
  DOC_SACADO: '123.456.789-09', ENTE_CONSIGNANTE: null, DATA_EMISSAO: '2026-08-01',
  DATA_VENCIMENTO_PRIMEIRA_PARCELA: '2026-09-10', DATA_VENCIMENTO_ULTIMA_PARCELA: '2026-10-10',
  relacaoParcelas: [
    { QUANTIDADE_PARCELAS: 2, NUMERO_PARCELA: 1, VALOR_NOMINAL: 500.5, DATA_VENCIMENTO_ORIGINAL: '2026-09-10' },
    { QUANTIDADE_PARCELAS: 2, NUMERO_PARCELA: 2, VALOR_NOMINAL: 500.5, DATA_VENCIMENTO_ORIGINAL: '2026-10-10' },
  ],
};

type Chamada = { etapa: string };

/** Cliente falso: classifica como `tipo` e devolve a extração dada. */
function clienteFalso(tipo: string, extracao: unknown, chamadas: Chamada[]): ClienteGemini {
  return {
    async enviarPdf() { return { nome: 'files/x', uri: 'https://exemplo.invalid/x', mimeType: 'application/pdf' }; },
    async gerarJson({ esquema }) {
      const classificacao = (esquema as { title?: string }).title === 'TipoDocumentoTenant';
      chamadas.push({ etapa: classificacao ? 'classificacao' : 'leitura' });
      const texto = classificacao ? JSON.stringify(Object.fromEntries(
        ['duplicata', 'ccb', 'termo_cessao', 'nota_comercial', 'confissao_divida', 'nota_promissoria', 'cpr', 'nota_fiscal_servicos', 'documento_identidade',
          'cnh', 'holerite', 'comprovante_renda', 'comprovante_averbacao', 'garantia', 'endosso', 'contrato_mae_cessao', 'relatorio_registradora',
          'outro_documento', 'intervencao_humana'].map((k) => [k, k === tipo]))) : JSON.stringify(extracao);
      return { texto, uso: { tokensEntrada: 2000, tokensSaida: 100 } };
    },
  };
}

function deps(cliente: ClienteGemini | null, paginas = 3): Dependencias {
  return { cliente: async () => cliente, contarPaginas: async () => paginas, modelo: 'gemini-3.1-flash-lite', maxPaginas: 50, esperar: async () => {} };
}

let baseId: string;

/** PDF gravado direto na pasta da base (sem disparar o indexador, que roda em outro processo). */
async function documentoPdf(loteId: string, nome: string): Promise<number> {
  const c = await dbMod.db();
  const bytes = new TextEncoder().encode(`%PDF-1.4 ${nome}`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(dbMod.pastaDePdfs(baseId), { recursive: true });
  writeFileSync(join(dbMod.pastaDePdfs(baseId), `${sha}.pdf`), bytes);
  const pdf = await repo.registrarPdf(baseId, { nome_arquivo: nome, caminho_relativo: nome, sha256: sha, tamanho: bytes.length });
  const agora = new Date().toISOString();
  const op = crypto.randomUUID();
  await c.prepare('INSERT INTO anexo_operacoes (id, lote_id, chave) VALUES (?, ?, ?)').run(op, loteId, nome.toLowerCase());
  const doc = Number((await c.prepare(`INSERT INTO anexo_documentos (lote_id, operacao_id, pdf_id, caminho, nome_arquivo, extensao, status, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, '.pdf', 'enfileirado', ?, ?)`).run(loteId, op, pdf.id, nome, nome, agora, agora)).lastInsertRowid);
  await c.prepare("INSERT INTO jobs (tipo, base_id, documento_id, status, criado_em, atualizado_em) VALUES ('leitura_lastro', ?, ?, 'pending', ?, ?)").run(baseId, doc, agora, agora);
  return doc;
}

const doc = async (id: number) => (await (await dbMod.db()).prepare('SELECT status, motivo, tipo_documento, paginas FROM anexo_documentos WHERE id = ?')
  .get<{ status: string; motivo: string | null; tipo_documento: string | null; paginas: number | null }>(id))!;
const sql = async (texto: string) => (await dbMod.db()).prepare(texto);

async function rodarFila(d: Dependencias) {
  fila.definirDependenciasFila(d);
  fila.chutarFila();
  await fila.aguardarFilaOciosa();
}

beforeAll(async () => {
  repo = await import('@/lib/repo');
  dbMod = await import('@/lib/db');
  lotes = await import('./lotes');
  fila = await import('./fila');
  leituras = await import('@/lib/leituras');
  acomp = await import('./acompanhamento');
  vis = await import('./visualizar');
  baseId = await repo.criarBase({
    nome: 'Base teste', nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', data_referencia: '2026-09-30',
    administradora: null, origem: 'amostra', arquivo_origem: 'amostra.xlsx', titulos: [], lados: ['lastro'],
  });
});

describe('leitura dos documentos do Anexo (fila local + Gemini falso)', () => {
  test('job que ficou processando ao reiniciar vira falha e não é refeito', async () => {
    const lote = await lotes.criarLote(baseId, false);
    const id = await documentoPdf(lote, 'interrompido.pdf');
    await (await sql("UPDATE jobs SET status = 'processing' WHERE documento_id = ?")).run(id);
    expect(await fila.recuperarInterrompidos()).toBe(1);
    expect(await doc(id)).toMatchObject({ status: 'erro', motivo: fila.MOTIVO_INTERROMPIDA });
    const job = await (await sql('SELECT status FROM jobs WHERE documento_id = ?')).get<{ status: string }>(id);
    expect(job?.status).toBe('failed');
  });

  test('XML de NF-e é lido localmente; caminho repetido no lote é recusado', async () => {
    const lote = await lotes.criarLote(baseId, true);
    const nfe = `<nfeProc><NFe><infNFe Id="NFe35260811222333000181550010000012341000012345"><ide><nNF>77</nNF><dhEmi>2026-08-01T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>11222333000181</CNPJ><xNome>EMPRESA FICTICIA LTDA</xNome></emit><dest><CNPJ>98765432000110</CNPJ><xNome>CLIENTE FICTICIO SA</xNome></dest>
      <cobr><dup><nDup>001</nDup><dVenc>2026-09-10</dVenc><vDup>100.00</vDup></dup></cobr></infNFe></NFe></nfeProc>`;
    const enc = (s: string) => new TextEncoder().encode(s);
    fila.definirDependenciasFila(deps(null));
    const r = await lotes.adicionarArquivos(lote, [
      { caminho: 'OP1/nota.xml', bytes: enc(nfe) }, { caminho: 'op1/NOTA.xml', bytes: enc(nfe) },
      { caminho: 'OP2/outro.xml', bytes: enc('<x/>') }, { caminho: 'solto.xml', bytes: enc('<x/>') }, { caminho: 'OP3/leia.txt', bytes: enc('x') },
    ]);
    expect(r.documentos).toBe(2);
    expect(r.recusados.map((x) => x.caminho).sort()).toEqual(['OP3/leia.txt', 'op1/NOTA.xml', 'solto.xml']);
    await fila.aguardarFilaOciosa();
    const estado = await lotes.obterLote(lote);
    const porCaminho = Object.fromEntries(estado.documentos.map((d) => [d.caminho, d]));
    expect(porCaminho['OP1/nota.xml']).toMatchObject({ status: 'lido', tipo_documento: 'nfe_xml', leituras: 1, operacao: 'OP1' });
    expect(porCaminho['OP2/outro.xml']).toMatchObject({ status: 'somente_classificado', motivo: 'XML sem extrator disponível' });
    expect(estado.leituras[0]).toMatchObject({ numero_documento: '77-001', valor_nominal: '100.00', tipo_recebivel: 'NOTA FISCAL ELETRONICA', origem: 'ia' });
    expect(estado.leituras[0].operacao_id).toBe(porCaminho['OP1/nota.xml'].operacao_id);
  });

  test('sem chave: erro com o motivo; "Tentar de novo" com o Gemini lê a CCB e registra o uso', async () => {
    const lote = await lotes.criarLote(baseId, false);
    const id = await documentoPdf(lote, 'ccb.pdf');
    await rodarFila(deps(null));
    expect(await doc(id)).toMatchObject({ status: 'erro', motivo: 'Configure a chave do Gemini (GEMINI_API_KEY) para ler os documentos' });
    expect((await acomp.acompanhamentoLotes()).bases.find((b) => b.base_id === baseId)?.ultimos_erros.some((e) => e.id === id)).toBe(true);

    const chamadas: Chamada[] = [];
    fila.definirDependenciasFila(deps(clienteFalso('ccb', CCB_LIDA, chamadas)));
    expect(await lotes.tentarDeNovo([id])).toBe(1);
    await fila.aguardarFilaOciosa();
    expect(await doc(id)).toMatchObject({ status: 'lido', tipo_documento: 'ccb', paginas: 3 });
    expect(chamadas.map((c) => c.etapa)).toEqual(['classificacao', 'leitura']);
    const lidas = await leituras.listarLeituras(baseId, { documentoId: id });
    expect(lidas).toHaveLength(2);
    expect(lidas[0]).toMatchObject({ tipo_recebivel: 'ccb', valor_nominal: '500.50', data_vencimento: '2026-09-10', numero_parcela: 1, quantidade_parcelas: 2, sacado_nome: 'JOÃO DA SILVA' });
    expect(leituras.ladoDaLeitura(lidas[0])).toBe('lastro');
    const uso = await (await sql('SELECT etapa, tokens_entrada, custo_usd FROM uso_ia WHERE documento_id = ? ORDER BY id')).all<{ etapa: string; tokens_entrada: number; custo_usd: number }>(id);
    expect(uso.map((u) => u.etapa)).toEqual(['classificacao', 'leitura']);
    expect(uso[0].custo_usd).toBeCloseTo(2000 * 0.00000025 + 100 * 0.0000015);

    // Ler de novo não duplica as leituras do documento.
    await (await sql("UPDATE anexo_documentos SET status = 'erro' WHERE id = ?")).run(id);
    await lotes.tentarDeNovo([id]);
    await fila.aguardarFilaOciosa();
    expect(await leituras.listarLeituras(baseId, { documentoId: id })).toHaveLength(2);
  });

  test('acima de 50 páginas não chama a IA; tipos sem leitura ficam só classificados', async () => {
    const lote = await lotes.criarLote(baseId, false);
    const grande = await documentoPdf(lote, 'grande.pdf');
    const chamadas: Chamada[] = [];
    await rodarFila(deps(clienteFalso('ccb', CCB_LIDA, chamadas), 60));
    expect((await doc(grande)).status).toBe('erro');
    expect((await doc(grande)).motivo).toContain('PDF com 60 páginas excede o limite de 50');
    expect(chamadas).toHaveLength(0);

    for (const [tipo, motivo] of [['cnh', 'Extração adicional não disponível na versão local'], ['garantia', 'Tipo classificado sem leitura por IA'], ['intervencao_humana', 'Tipo sem extração automática']]) {
      const id = await documentoPdf(lote, `${tipo}.pdf`);
      await rodarFila(deps(clienteFalso(tipo, null, [])));
      expect(await doc(id)).toMatchObject({ status: 'somente_classificado', tipo_documento: tipo, motivo });
    }
  });

  test('leitura inválida 3 vezes vira erro com o motivo e o custo das 3 tentativas', async () => {
    const lote = await lotes.criarLote(baseId, false);
    const id = await documentoPdf(lote, 'ruim.pdf');
    await rodarFila(deps(clienteFalso('duplicata', { NU_DOCUMENTO: 'X' }, [])));
    expect((await doc(id)).status).toBe('erro');
    expect((await doc(id)).tipo_documento).toBe('duplicata');
    expect((await doc(id)).motivo).toContain('O Gemini não devolveu uma leitura válida em 3 tentativas');
    const uso = await (await sql("SELECT tokens_entrada FROM uso_ia WHERE documento_id = ? AND etapa = 'leitura'")).get<{ tokens_entrada: number }>(id);
    expect(uso?.tokens_entrada).toBe(6000);
  });

  test('Visualizar: filtros sem acento e por dígitos; reaproveitar leitura entre bases do fundo', async () => {
    const r = await vis.buscarLeituras({ nome_sacado: 'joao', doc_sacado: '12345678909' });
    expect(r.total).toBe(2);
    expect(r.linhas[0].pdf_nome).toBe('ccb.pdf');
    expect((await vis.buscarLeituras({ aquisicao_de: '2030-01-01' })).total).toBe(0);
    expect((await vis.buscarLeituras({}, { ordenarPor: 'valor_nominal', direcao: 'asc' })).linhas[0].valor_nominal).toBe('100.00');

    const outra = await repo.criarBase({
      nome: 'Base 2', nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', data_referencia: '2026-12-31',
      administradora: null, origem: 'amostra', arquivo_origem: 'a.xlsx', titulos: [], lados: ['lastro'],
    });
    const total = (await leituras.listarLeituras(baseId)).length;
    expect(await lotes.reaproveitarLeituras(baseId, outra)).toBe(total);
    expect(await lotes.reaproveitarLeituras(baseId, outra)).toBe(0);
    expect((await leituras.listarLeituras(outra)).every((l) => l.documento_id === null)).toBe(true);
    expect((await lotes.buscarBases({ data: '2026-11-15', modo: 'TRIMESTRE' })).map((b) => b.id)).toEqual([outra]);
  });
});
