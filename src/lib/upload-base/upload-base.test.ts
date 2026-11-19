import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { fimDoTrimestre, intervaloReferencia, normalizarDataReferencia, rotuloReferencia, ultimoDiaDoTrimestre } from './datas';
import { resumirErros } from './erros';
import { analisarTabela, lerTabela } from './planilha';
import { aplicarMapeamento, completarVencimento, mapeamentoEfetivo } from './processar';
import { mapeamentoInteligente } from '@/lib/planilha/importar';
import { COLUNAS_UPLOAD } from './colunas';

// Banco num diretório temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-upload-'));
delete (globalThis as { __batePdfDb?: unknown }).__batePdfDb;

let registrar: typeof import('./registrar');
let fundos: typeof import('@/lib/fundos');
let repo: typeof import('@/lib/repo');

beforeAll(async () => {
  registrar = await import('./registrar');
  fundos = await import('@/lib/fundos');
  repo = await import('@/lib/repo');
});

async function xlsx(abas: Record<string, unknown[][]>): Promise<Uint8Array> {
  const livro = new ExcelJS.Workbook();
  for (const [nome, linhas] of Object.entries(abas)) {
    const aba = livro.addWorksheet(nome);
    linhas.forEach((l, i) => { aba.getRow(i + 1).values = l as ExcelJS.CellValue[]; });
  }
  return new Uint8Array(await livro.xlsx.writeBuffer() as ArrayBuffer);
}

const CABECALHO = ['Cedente', 'CNPJ Cedente', 'Sacado', 'CPF_CNPJ SACADO', 'SEU NUMERO', 'NUMERO DOCUMENTO', 'Valor Nominal', 'Data Emissao', 'DATA_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO_AJUSTADA'];

describe('datas de referência (date_utils.py)', () => {
  test('trimestre e data exata', () => {
    expect(fimDoTrimestre(1, 2024)).toBe('2024-03-31');
    expect(fimDoTrimestre(4, 2026)).toBe('2026-12-31');
    expect(ultimoDiaDoTrimestre('2026-08-15')).toBe('2026-09-30');
    expect(normalizarDataReferencia('2026-08-15', 'TRIMESTRE')).toBe('2026-09-30');
    expect(normalizarDataReferencia('2026-08-15', 'DATA_REFERENCIA')).toBe('2026-08-15');
    expect(intervaloReferencia('2026-08-15', 'TRIMESTRE')).toEqual(['2026-07-01', '2026-09-30']);
    expect(intervaloReferencia('2026-08-15', 'DATA_REFERENCIA')).toEqual(['2026-08-15', '2026-08-15']);
    expect(rotuloReferencia('2026-09-30', 'TRIMESTRE')).toBe('3º Trim/2026');
    expect(rotuloReferencia('2026-08-15', 'DATA_REFERENCIA')).toBe('15/08/2026');
  });
});

describe('mapeamento (mapeamento_inteligente / analisar_arquivo)', () => {
  test('mesmas escolhas do Bate Lastro nas 12 colunas', () => {
    const m = mapeamentoInteligente(CABECALHO, COLUNAS_UPLOAD);
    expect(m).toEqual({
      Cedente: 'NOME_CEDENTE',
      'CNPJ Cedente': 'DOC_CEDENTE',
      Sacado: 'NOME_SACADO',
      'CPF_CNPJ SACADO': 'DOC_SACADO',
      'NUMERO DOCUMENTO': 'NU_DOCUMENTO',
      'Valor Nominal': 'VALOR_NOMINAL',
      'Data Emissao': 'DATA_EMISSAO',
      DATA_VENCIMENTO_ORIGINAL: 'DATA_VENCIMENTO_ORIGINAL',
    });
    // As colunas extras do formato de amostra (NOME_FUNDO/CNPJ_FUNDO) não entram no Upload Base.
    expect(mapeamentoInteligente(['FUNDO', 'NU_DOCUMENTO'], COLUNAS_UPLOAD)).toEqual({ NU_DOCUMENTO: 'NU_DOCUMENTO' });
  });

  test('lê a aba com mais colunas reconhecidas, nomes repetidos e linhas vazias', async () => {
    const arquivo = await xlsx({
      Resumo: [['Campo', 'Valor'], ['Seed', 'X']],
      Amostra: [[], CABECALHO.concat(['Cedente']), ['EMPRESA A', '11222333000181', 'JOAO', '12345678909', 'S1', '001', 100, '01/08/2026', '10/10/2026', '']],
    });
    const t = await lerTabela(arquivo, 'amostra.xlsx');
    expect(t.aba).toBe('Amostra');
    expect(t.colunas.at(-1)).toBe('Cedente.1');
    expect(t.linhas[0].numero).toBe(3);
    const a = analisarTabela(t);
    expect(a.total_linhas).toBe(1);
    expect(a.colunas_vencimento).toEqual(['DATA_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO_AJUSTADA']);
    expect(a.precisa_mapeamento).toBe(true);
    await expect(lerTabela(arquivo, 'amostra.xls')).rejects.toThrow(/salve como \.xlsx/);
  });
});

describe('processamento (aplicar_mapeamento + validar)', () => {
  const linhas = [
    CABECALHO,
    ['EMPRESA A', '11222333000181', 'JOAO', '12345678909', 'S1', 1234.0, '1.613,33', '01/08/2026', '10/10/2026', '11/10/2026'],
    ['EMPRESA A', '11222333000181', 'MARIA', '98765432100', 'S2', '12C3-4', 'R$ 2.500,00', new Date(Date.UTC(2026, 7, 2)), '', '12/11/2026'],
  ];

  test('cria os títulos; vencimento vazio usa a outra coluna (completar_vencimento)', async () => {
    const t = await lerTabela(await xlsx({ P: linhas }), 'a.xlsx');
    const r = aplicarMapeamento(t, mapeamentoInteligente(t.colunas, COLUNAS_UPLOAD));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.titulos[0]).toMatchObject({ numero_documento: '1234', valor_total: '1613.33', data_emissao: '2026-08-01', data_vencimento: '2026-10-10', linha_origem: 2 });
    expect(r.titulos[1]).toMatchObject({ numero_documento: '12C3-4', valor_total: '2500.00', data_emissao: '2026-08-02', data_vencimento: '2026-11-12' });
    expect(r.vencimento).toEqual({ coluna: 'DATA_VENCIMENTO_ORIGINAL', completados: 1, por_coluna: { DATA_VENCIMENTO_AJUSTADA: 1 } });
  });

  test('nada mapeado para o vencimento: a coluna de vencimento assume', () => {
    const r = completarVencimento({ A: 'NU_DOCUMENTO' }, ['A', 'Vencimento Ajustado', 'Valor Vencimento']);
    expect(r.mapeamento).toEqual({ A: 'NU_DOCUMENTO', 'Vencimento Ajustado': 'DATA_VENCIMENTO_ORIGINAL' });
  });

  test('mapeamento vazio = colunas com o nome do padrão ou as sugestões; destino repetido vale a primeira', () => {
    expect(mapeamentoEfetivo({}, ['NU_DOCUMENTO', 'Sacado'])).toEqual({ NU_DOCUMENTO: 'NU_DOCUMENTO' });
    expect(mapeamentoEfetivo(undefined, ['Sacado'])).toEqual({ Sacado: 'NOME_SACADO' });
    expect(mapeamentoEfetivo({ A: 'NOME_SACADO', B: 'NOME_SACADO', C: '' }, ['A', 'B', 'C'])).toEqual({ A: 'NOME_SACADO' });
  });

  test('erros com a linha do Excel e o resumo do Bate Lastro', async () => {
    const t = await lerTabela(await xlsx({ P: [
      CABECALHO,
      ['', '11222333000181', 'JOAO', '', 'S1', '1', 'abc', '32/13/2026', '10/10/2026', ''],
      ['', '11222333000181', 'MARIA', '1', 'S2', '2', '0', '01/08/2026', '10/10/2026', ''],
    ] }), 'a.xlsx');
    const r = aplicarMapeamento(t, mapeamentoInteligente(t.colunas, COLUNAS_UPLOAD));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toEqual([
      { tipo: 'vazio', campo: 'NOME_CEDENTE', linhas: [2, 3] },
      { tipo: 'vazio', campo: 'DOC_SACADO', linhas: [2] },
      { tipo: 'data', campo: 'DATA_EMISSAO', linhas: [2] },
      { tipo: 'valor', campo: 'VALOR_NOMINAL', linhas: [2] },
    ]);
    expect(resumirErros(r.erros)).toBe(
      "Dados inválidos encontrados: 'NOME_CEDENTE' vazio em 2 linhas; 'DOC_SACADO' vazio em 1 linha; data inválida em 'DATA_EMISSAO' em 1 linha (+1 outro erro)",
    );
  });
});

describe('registro da base no banco', () => {
  test('cria a base do fundo, avisa upload recente e importa o resultados_matching', async () => {
    const adm = fundos.criarAdministradora('Adm Teste Upload');
    const fundo = fundos.criarFundo({ nome: 'FIDC Upload', cnpj: '11222333000181', administradora_id: adm.id });
    const arquivo = await xlsx({ P: [
      ['NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO', 'DOC_SACADO', 'NU_DOCUMENTO', 'VALOR_NOMINAL'],
      ['EMPRESA A', '11222333000181', 'JOAO', '12345678909', '001', '10,00'],
    ] });
    expect(registrar.uploadsRecentes({ fundo_id: fundo.id, data_referencia: '2026-08-15', modo: 'TRIMESTRE' }).tem_uploads_recentes).toBe(false);
    const r = await registrar.registrarBase({ fundo_id: fundo.id, data_referencia: '2026-08-15', modo: 'TRIMESTRE', arquivo: { nome: 'a.xlsx', conteudo: arquivo }, mapeamento: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.base).toMatchObject({ nome: 'FIDC Upload — 3º Trim/2026', total_registros: 1, pendentes: { termo: 1, lastro: 1 }, blacklist: [] });
    expect(repo.obterBase(r.base.base_id)).toMatchObject({
      fundo_id: fundo.id, modo_referencia: 'TRIMESTRE', data_referencia: '2026-09-30', cnpj_fundo: '11222333000181',
      nome_fundo: 'FIDC Upload', administradora: 'Adm Teste Upload', origem: 'amostra',
    });
    const recente = registrar.uploadsRecentes({ fundo_id: fundo.id, data_referencia: '2026-07-01', modo: 'TRIMESTRE' });
    expect(recente).toMatchObject({ tem_uploads_recentes: true, quantidade_uploads: 1 });
    expect(registrar.uploadsRecentes({ fundo_id: fundo.id, data_referencia: '2026-07-01', modo: 'DATA_REFERENCIA' }).tem_uploads_recentes).toBe(false);
    await expect(registrar.registrarBase({ fundo_id: 999, data_referencia: '2026-08-15', modo: 'TRIMESTRE', arquivo: { nome: 'a.xlsx', conteudo: arquivo } }))
      .rejects.toThrow(/não está cadastrado/);

    // Contingência: resultados_matching (STATUS V vira já batido; o fundo é achado pelo CNPJ).
    const resultado = await xlsx({
      TERMO: [['DADOS TERMO'], [], ['ID_BASE', 'STATUS', 'BASE_NUMERO_DOC', 'BASE_CNPJ_FUNDO', 'BASE_NOME_FUNDO'], [10, 'V', '001', '11222333000181', 'FIDC Upload']],
      LASTRO: [['DADOS LASTRO'], [], ['ID_BASE', 'STATUS', 'BASE_NUMERO_DOC'], [10, 'P', '001']],
    });
    const nome = 'resultados_matching_11222333000181_202611181000.xlsx';
    const previa = await registrar.previaResultados(resultado, nome);
    expect(previa).toMatchObject({ titulos: 1, pendentes: { termo: 0, lastro: 1 }, ja_batidos: 1, fundo_sugerido: { id: fundo.id } });
    const base = await registrar.registrarResultados({ arquivo: { nome, conteudo: resultado }, modo: 'DATA_REFERENCIA' });
    expect(repo.obterBase(base.base_id)).toMatchObject({ origem: 'resultados_matching', fundo_id: fundo.id, ja_batidos: 1, pendentes: { termo: 0, lastro: 1 } });
    await expect(registrar.previaResultados(arquivo, 'a.xlsx')).rejects.toThrow(/não é um resultados_matching/);
  });
});
