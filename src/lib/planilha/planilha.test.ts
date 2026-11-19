import { describe, expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { lerPlanilha, mapeamentoInteligente, normalizarNomeColuna } from './importar';
import { cabecalhoDaAba, gerarPlanilhaResultados, nomeDoArquivo, type LinhaExportacao } from './exportar';
import { lerData, lerMoeda, formatarMoeda } from '@/lib/valores';
import { normalizarTexto } from '@/lib/texto';

// Dados fictícios.
async function xlsx(abas: Record<string, unknown[][]>): Promise<Uint8Array> {
  const livro = new ExcelJS.Workbook();
  for (const [nome, linhas] of Object.entries(abas)) {
    const aba = livro.addWorksheet(nome);
    linhas.forEach((l, i) => { aba.getRow(i + 1).values = l as ExcelJS.CellValue[]; });
  }
  return new Uint8Array(await livro.xlsx.writeBuffer() as ArrayBuffer);
}

describe('valores', () => {
  test('moeda nos formatos do upload do Bate Lastro', () => {
    expect(lerMoeda('1.234,56')).toBe('1234.56');
    expect(lerMoeda('R$ 789,64')).toBe('789.64');
    expect(lerMoeda('1,234.56')).toBe('1234.56');
    expect(lerMoeda('115.56')).toBe('115.56');
    expect(lerMoeda('1.000')).toBe('1000.00');
    expect(lerMoeda(1613.33)).toBe('1613.33');
    expect(lerMoeda(1234.5600000000001)).toBe('1234.56');
    expect(lerMoeda('0')).toBeNull();
    expect(lerMoeda('')).toBeNull();
    expect(formatarMoeda('1613.33')).toBe('R$ 1.613,33');
  });

  test('data com dia primeiro, nunca MM/DD', () => {
    expect(lerData('03/04/2026')).toBe('2026-04-03');
    expect(lerData('2026-04-03')).toBe('2026-04-03');
    expect(lerData(new Date(Date.UTC(2026, 3, 3)))).toBe('2026-04-03');
    expect(lerData(46115)).toBe('2026-04-03'); // série do Excel
    expect(lerData('31/02/2026')).toBeNull();
  });

  test('normalização preserva o comprimento', () => {
    const t = 'CESSÃO de Crédito Nº 1 — João';
    expect(normalizarTexto(t)).toBe('cessao de credito nº 1 — joao');
    expect(normalizarTexto(t).length).toBe(t.length);
  });
});

describe('importação da amostra', () => {
  test('reconhece as colunas pelo mapeamento do upload', () => {
    expect(normalizarNomeColuna('Número do Documento')).toBe('numerodocumento');
    const m = mapeamentoInteligente(['SEU NUMERO', 'NUMERO DOCUMENTO', 'CPF_CNPJ SACADO', 'NOME SACADO', 'VALOR NOMINAL', 'DATA VENCIMENTO']);
    expect(m['NUMERO DOCUMENTO']).toBe('NU_DOCUMENTO');
    expect(m['CPF_CNPJ SACADO']).toBe('DOC_SACADO');
    expect(m['NOME SACADO']).toBe('NOME_SACADO');
    expect(m['VALOR NOMINAL']).toBe('VALOR_NOMINAL');
    expect(m['DATA VENCIMENTO']).toBe('DATA_VENCIMENTO_ORIGINAL');
  });

  test('lê a amostra e cria os dois lados pendentes', async () => {
    const arquivo = await xlsx({
      Planilha1: [
        ['NU_DOCUMENTO', 'NOME_SACADO', 'DOC_SACADO', 'NOME_CEDENTE', 'DOC_CEDENTE', 'VALOR_NOMINAL', 'DATA_EMISSAO', 'DATA_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO_AJUSTADA'],
        ['123456', 'JOAO DA SILVA', '123.456.789-09', 'EMPRESA FICTICIA LTDA', '11.222.333/0001-81', 1613.33, '01/08/2026', '10/10/2026', '10/10/2026'],
        ['12C3-45678', 'MARIA SOUZA', '98765432100', 'EMPRESA FICTICIA LTDA', '11222333000181', '2.500,00', '01/08/2026', '', '12/11/2026'],
      ],
    });
    const r = await lerPlanilha(arquivo, 'amostra.xlsx');
    expect(r.formato).toBe('amostra');
    expect(r.titulos).toHaveLength(2);
    expect(r.titulos[0]).toMatchObject({
      numero_documento: '123456', valor_total: '1613.33', data_emissao: '2026-08-01', data_vencimento: '2026-10-10',
      lados: { termo: 'pendente', lastro: 'pendente' }, id_base_origem: null,
    });
    // Vencimento original vazio: vale o ajustado (completar_vencimento).
    expect(r.titulos[1]).toMatchObject({ numero_documento: '12C3-45678', valor_total: '2500.00', data_vencimento: '2026-11-12' });
  });

  test('recusa planilha sem número do documento', async () => {
    const arquivo = await xlsx({ X: [['A', 'B'], [1, 2]] });
    await expect(lerPlanilha(arquivo, 'x.xlsx')).rejects.toThrow(/número do documento/);
  });

  test('lê CSV com ponto e vírgula', async () => {
    const csv = new TextEncoder().encode('NU_DOCUMENTO;NOME_SACADO;VALOR_NOMINAL\n"001";JOAO;"1.613,33"\n');
    const r = await lerPlanilha(csv, 'amostra.csv');
    expect(r.titulos[0]).toMatchObject({ numero_documento: '001', valor_total: '1613.33' });
  });
});

describe('resultados_matching (ida e volta)', () => {
  const titulo = {
    id_base_origem: 987, numero_documento: '123456', sacado_nome: 'JOAO DA SILVA', sacado_documento: '12345678909',
    cedente_nome: 'EMPRESA FICTICIA LTDA', cedente_documento: '11222333000181', valor_total: '1613.33', valor_aquisicao: '1500.00',
    data_emissao: '2026-08-01', data_vencimento: '2026-10-10', data_aquisicao: '2026-09-15',
    nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', tipo_recebivel: 'CCB', chave_nfe: null,
  };

  test('o cabeçalho segue o export do Bate Lastro', () => {
    const termo = cabecalhoDaAba('termo');
    const lastro = cabecalhoDaAba('lastro');
    expect(termo.slice(0, 3)).toEqual(['ID_BASE', 'STATUS', 'BASE_NUMERO_DOC']);
    expect(termo).toContain('DIV_DOC_CESSIONARIO');
    expect(lastro).not.toContain('DIV_DOC_CESSIONARIO');
    expect(lastro).not.toContain('BASE_CNPJ_FUNDO');
    // Mesmo nome do export do Bate Lastro (hora local).
    expect(nomeDoArquivo('12.345.678/0001-95', new Date(2026, 10, 18, 10, 5, 9))).toBe('resultados_matching_12345678000195_20261118_100509.xlsx');
    expect(termo).toContain('BLACKLIST');
    expect(lastro).toContain('STATUS_NFE');
    expect(termo).not.toContain('LASTRO_GARANTIA');
    expect(termo.slice(-3)).toEqual(['PDF_ARQUIVO', 'PDF_PAGINA', 'ORIGEM_BATE_PDF']);
  });

  test('o arquivo exportado volta a ser lido como resultados_matching', async () => {
    const linhas: LinhaExportacao[] = [
      {
        lado: 'lastro', titulo, status: 'V',
        marcacoes: { numero_documento: 'V', sacado_nome: 'V', sacado_documento: 'V', cedente_nome: 'V', cedente_documento: 'V', valor_total: 'V', data_emissao: 'D', data_vencimento: 'V' },
        leitura: { numero_documento: '123456', valor_total: '1613.33', data_emissao: '2026-08-02', data_vencimento: '2026-10-10' },
        pdf: { nome: 'ccb.pdf', pagina: 1 }, origem: 'bate-pdf:manual',
      },
      { lado: 'termo', titulo, status: 'P', marcacoes: {}, leitura: {} },
    ];
    const bytes = await gerarPlanilhaResultados(linhas, { nome: 'teste', cnpj: titulo.cnpj_fundo, geradoEm: new Date() });
    const lido = await lerPlanilha(bytes, nomeDoArquivo(titulo.cnpj_fundo));
    expect(lido.formato).toBe('resultados_matching');
    expect(lido.cnpj_fundo).toBe('12345678000195');
    expect(lido.titulos).toHaveLength(1);
    expect(lido.titulos[0]).toMatchObject({
      id_base_origem: 987, numero_documento: '123456', valor_total: '1613.33', data_vencimento: '2026-10-10',
      lados: { lastro: 'ja_batido', termo: 'pendente' },
    });

    // As colunas que o importador do Bate Lastro lê.
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(bytes.buffer as ArrayBuffer);
    const aba = livro.getWorksheet('LASTRO')!;
    expect(aba.getCell('A1').value).toBe('DADOS LASTRO');
    const cab = (aba.getRow(3).values as string[]).slice(1);
    const linha4 = aba.getRow(4);
    const col = (nome: string) => linha4.getCell(cab.indexOf(nome) + 1).value;
    expect(col('ID_BASE')).toBe(987);
    expect(col('STATUS')).toBe('V');
    expect(col('DIV_DATA_EMISSAO')).toBe('D');
    expect(col('LEITURA_DATA_EMISSAO')).toBe('02/08/2026');
    expect(col('LEITURA_VALOR_NOMINAL')).toBe(1613.33);
    expect(col('PDF_ARQUIVO')).toBe('ccb.pdf');
    expect(col('BLACKLIST')).toBe('Não');
    expect(livro.getWorksheet('Resumo Executivo')!.getCell('A6').value).toBe('TERMO');
  });

  test('DIV_* sem veredito salvo vem da comparação (calc_divergencia); já batido sai sem DIV', async () => {
    const linhas: LinhaExportacao[] = [
      {
        // Pré-bate: sem vereditos salvos; o doc. do sacado vem com máscara (D, como lá) e falta a emissão (P).
        lado: 'lastro', titulo, status: 'V', marcacoes: {},
        leitura: { numero_documento: '00123456', sacado_nome: 'JOAO DA SILVA', sacado_documento: '123.456.789-09', valor_total: '1613.33', data_vencimento: '2026-10-10' },
      },
      { lado: 'termo', titulo, status: 'V', marcacoes: {}, leitura: {}, jaBatido: true },
    ];
    const bytes = await gerarPlanilhaResultados(linhas, { nome: 't', cnpj: titulo.cnpj_fundo, geradoEm: new Date() });
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(bytes.buffer as ArrayBuffer);
    const ler = (aba: string) => {
      const ws = livro.getWorksheet(aba)!;
      const cab = (ws.getRow(3).values as string[]).slice(1);
      return (nome: string) => ws.getRow(4).getCell(cab.indexOf(nome) + 1).value;
    };
    const lastro = ler('LASTRO');
    expect(lastro('DIV_NUMERO_DOC')).toBe('D'); // '00123456' ≠ '123456' (chave alfanumérica)
    expect(lastro('DIV_NOME_SACADO')).toBe('V');
    expect(lastro('DIV_DOC_SACADO')).toBe('D');
    expect(lastro('DIV_DATA_EMISSAO')).toBe('P');
    expect(lastro('DIV_VALOR_NOMINAL')).toBe('V');
    expect(lastro('DIV_DATA_VENCIMENTO')).toBe('V');
    const termo = ler('TERMO');
    expect(termo('STATUS')).toBe('V');
    expect(termo('DIV_NUMERO_DOC')).toBeNull();
  });
});
