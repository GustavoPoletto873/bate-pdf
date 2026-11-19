import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  adivinharFormato, arredondarParaPar, centavosCanonicos, colunaData, colunaValor, floatify, inferirColuna, lerCsv, lerXlsx,
  pyFloatRepr, pyStrip, texto, tokenizarCsv,
} from './pandas';
import { canonizar, dataBase, deduplicar, lerChavesAnteriores, lerEstoques, lerLiquidados, normalizarColunas, populacaoCsv } from './leitura';

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

async function xlsx(linhas: unknown[][]): Promise<Uint8Array> {
  const livro = new ExcelJS.Workbook();
  const aba = livro.addWorksheet('Estoque');
  for (const l of linhas) aba.addRow(l);
  return new Uint8Array(await livro.xlsx.writeBuffer());
}

describe('pandas: números', () => {
  it('floatify como o precise_xstrtod', () => {
    expect(floatify(' 12 ')).toEqual({ valor: 12, inteiro: true });
    expect(floatify('1234.56')).toEqual({ valor: 1234.56, inteiro: false });
    expect(floatify('-1e3')?.valor).toBe(-1000);
    expect(floatify('+.5')?.valor).toBe(0.5);
    expect(floatify('1,5')).toBeNull();
    expect(floatify('R$ 10')).toBeNull();
    expect(floatify('inf')?.valor).toBe(Infinity);
    expect(floatify('.')).toBeNull();
  });
  it('np.round arredonda meio para o par', () => {
    expect(arredondarParaPar(12.5)).toBe(12);
    expect(arredondarParaPar(13.5)).toBe(14);
    expect(arredondarParaPar(-12.5)).toBe(-12);
    expect(centavosCanonicos(0.125)).toBe('0.12');
    expect(centavosCanonicos(-0.001)).toBe('0.00');
    expect(centavosCanonicos(-1234.5)).toBe('-1234.50');
    expect(centavosCanonicos(null)).toBe('0.00');
  });
  it('valor em texto passa pela conversão brasileira (tira o ponto!)', () => {
    const col = { nome: 'V', numerica: false, valores: ['1.234,56', '1234.56', null, 'abc', '10'] };
    expect(colunaValor(col, 5)).toEqual(['1234.56', '123456.00', '0.00', '0.00', '10.00']);
    expect(colunaValor({ nome: 'V', numerica: true, valores: [99.999, 1] }, 2)).toEqual(['100.00', '1.00']);
    expect(colunaValor(undefined, 2)).toEqual(['0.00', '0.00']);
  });
  it('repr de float do Python', () => {
    expect(pyFloatRepr(1.5)).toBe('1.5');
    expect(pyFloatRepr(1.5e-5)).toBe('1.5e-05');
    expect(pyFloatRepr(1.25e17)).toBe('1.25e+17');
    expect(texto(3.52e43)).toBe(BigInt(3.52e43).toString());
    expect(texto(12345.0)).toBe('12345');
  });
});

describe('pandas: texto', () => {
  it('strip do Python e NaN', () => {
    expect(pyStrip('\u0085 abc  ')).toBe('abc');
    expect(pyStrip('﻿abc')).toBe('﻿abc');
    expect(texto(null)).toBe('-');
    expect(texto('   ')).toBe('-');
    expect(texto(true)).toBe('True');
  });
});

describe('pandas: CSV', () => {
  it('aspas, ponto e vírgula, linhas em branco e índice implícito', () => {
    expect(tokenizarCsv('a;b\r\n"x;1";"di""z"\n\n  \n3;4')).toEqual([['a', 'b'], ['x;1', 'di"z'], ['3', '4']]);
    const q = lerCsv(latin1('A;B\n1;2;3\n4;5;6\n'));
    expect(q.colunas.map((c) => c.valores)).toEqual([['2', '5'], ['3', '6']]);
    expect(() => lerCsv(latin1('A;B\n1;2\n4;5;6\n'))).toThrow(/Expected 2 fields/);
  });
  it('latin1 do Python, NA do pandas e colunas repetidas', () => {
    const q = lerCsv(latin1('Nome;Nome;X \n\x96Jos\xe9;NA;N/A\n'));
    expect(q.colunas.map((c) => c.nome)).toEqual(['Nome', 'Nome.1', 'X']);
    expect(q.colunas.map((c) => c.valores[0])).toEqual(['\u0096José', null, null]);
  });
});

describe('pandas: datas', () => {
  it('formato do primeiro valor vale para a coluna toda (estrito)', () => {
    const col = { nome: 'D', numerica: false, valores: ['15/03/2026', '5/4/2026', '2026-04-05', '31/02/2026', null, '01/01/2026 10:00'] };
    expect(colunaData(col, 6)).toEqual(['2026-03-15', '2026-04-05', '', '', '', '']);
  });
  it('dia/mês ambíguo com dayfirst; mês/dia quando o segundo passa de 12', () => {
    expect(colunaData({ nome: 'D', numerica: false, valores: ['03/04/2026'] }, 1)).toEqual(['2026-04-03']);
    expect(colunaData({ nome: 'D', numerica: false, valores: ['03/15/2026', '03/16/2026'] }, 2)).toEqual(['2026-03-15', '2026-03-16']);
    expect(adivinharFormato('texto')).toBeNull();
  });
  it('células de data do Excel e números (nanossegundos desde 1970)', () => {
    expect(colunaData({ nome: 'D', numerica: false, valores: [new Date(Date.UTC(2026, 8, 30)), 'x'] }, 2)).toEqual(['2026-09-30', '']);
    expect(colunaData({ nome: 'D', numerica: true, valores: [46000, null] }, 2)).toEqual(['1970-01-01', '']);
  });
});

describe('pandas: Excel', () => {
  it('texto numérico vira número (perde zeros à esquerda), como o read_excel', async () => {
    expect(inferirColuna('X', ['00123', 5, '']).valores).toEqual([123, 5, null]);
    expect(inferirColuna('X', ['00123', 'A1']).valores).toEqual(['00123', 'A1']);
    expect(inferirColuna('X', ['TRUE', false]).valores).toEqual([true, false]);
    const q = await lerXlsx(await xlsx([['DOCUMENTO', 'NOME'], ['000123', 'A'], [null, 'B']]));
    expect(q.linhas).toBe(2);
    expect(q.colunas[0]).toMatchObject({ nome: 'DOCUMENTO', numerica: true, valores: [123, null] });
  });
});

const CAB = 'FUNDO;CEDENTE;IDENTIFICACAO_CEDENTE;SACADO;IDENTIFICACAO_SACADO;DOCUMENTO;SEU_NUMERO;VALOR_PRESENTE;VALOR_VENCIMENTO;DATA_VENCIMENTO;DATA_AQUISICAO;DATA_REFERENCIA';
const linha = (doc: string, numero: string, vp: string, venc: string, aq: string) =>
  `FIDC FICTICIO;CEDENTE X;${doc};SACADO Y;123.456.789-09;${numero};${numero}-1;${vp};${vp};${venc};${aq};30/09/2026`;

describe('leitura do estoque', () => {
  it('layout padrão, deduplica pela chave (fica o maior valor) e lê a data-base', async () => {
    const csv = [CAB,
      linha('11.111.111/0001-11', '1', '1.000,50', '15/08/2026', '01/07/2026'),
      linha('11111111000111', '1', '2.000,00', '15/08/2026', '01/07/2026'),
      linha('22.222.222/0001-22', '2', '10,00', '20/09/2026', '01/01/2026'),
    ].join('\n');
    const { populacao, avisos, dataBase: ref } = await lerEstoques([{ nome: 'Estoque.csv', conteudo: latin1(csv) }], '2026-07-01', '2026-09-30');
    expect(ref).toBe('2026-09-30');
    expect(avisos).toEqual([]);
    expect(populacao).toHaveLength(2);
    expect(populacao[0]).toMatchObject({ DOC_CEDENTE: '11111111000111', VALOR_PRESENTE: '2000.00', DATA_VENCIMENTO_AJUSTADA: '2026-08-15', DATA_AQUISICAO: '2026-07-01' });
    const texto = new TextDecoder().decode(populacaoCsv(populacao));
    expect(texto.split('\n')[0]).toBe('NOME_FUNDO,NOME_CEDENTE,DOC_CEDENTE,NOME_SACADO,DOC_SACADO,SEU_NUMERO,NU_DOCUMENTO,TIPO_RECEBIVEL,VALOR_NOMINAL,VALOR_PRESENTE,VALOR_AQUISICAO,DATA_VENCIMENTO_ORIGINAL,DATA_VENCIMENTO_AJUSTADA,DATA_EMISSAO,DATA_AQUISICAO,CHAVE_NFE');
    expect(texto.endsWith('\n')).toBe(true);
  });

  it('período depois da data-base é recusado; layout sem colunas obrigatórias também', async () => {
    const csv = [CAB, linha('1', '1', '1,00', '15/08/2026', '01/07/2026')].join('\n');
    await expect(lerEstoques([{ nome: 'Estoque.csv', conteudo: latin1(csv) }], '2026-07-01', '2026-10-31')).rejects.toThrow(/posterior à data-base do estoque \(30\/09\/2026\)/);
    await expect(lerEstoques([{ nome: 'Estoque.csv', conteudo: latin1('A;B\n1;2') }], '2026-07-01', '2026-09-30')).rejects.toThrow(/layout não reconhecido/);
    await expect(lerEstoques([{ nome: 'Estoque.pdf', conteudo: latin1('x') }], '2026-07-01', '2026-09-30')).rejects.toThrow(/somente arquivos CSV ou XLSX/);
  });

  it('avisa quando nada foi adquirido nem venceu no período', async () => {
    const csv = [CAB, linha('1', '1', '1,00', '15/01/2026', '01/01/2026')].join('\n');
    const { avisos } = await lerEstoques([{ nome: 'Estoque.csv', conteudo: latin1(csv) }], '2026-07-01', '2026-09-30');
    expect(avisos[0]).toMatch(/Maiores Cedentes não é filtrado/);
  });

  it('estoque em XLSX com layout não padrão', async () => {
    const bytes = await xlsx([
      ['Nome Fundo', 'Cedente', 'CPF/CNPJ Cedente', 'Número Documento', 'Seu Número', 'Valor Presente', 'Data Aquisição', 'Data Vencimento', 'Data Referência'],
      ['FIDC', 'CED', '11111111000111', '000123', 'A', 1500.5, new Date(Date.UTC(2026, 7, 1)), new Date(Date.UTC(2026, 10, 1)), '31/ago/2026'],
    ]);
    const q = normalizarColunas(await lerXlsx(bytes));
    expect(dataBase(q)).toBe('2026-08-31');
    const [t] = canonizar(q);
    expect(t).toMatchObject({ NU_DOCUMENTO: '123', SEU_NUMERO: 'A', VALOR_PRESENTE: '1500.50', DATA_AQUISICAO: '2026-08-01', DATA_VENCIMENTO_AJUSTADA: '2026-11-01', CHAVE_NFE: '-' });
  });

  it('dedup ordena por chave e é estável entre ordens de entrada', () => {
    const base = { NOME_FUNDO: '-', NOME_CEDENTE: '-', NOME_SACADO: '-', DOC_SACADO: '-', TIPO_RECEBIVEL: '-', VALOR_NOMINAL: '0.00', VALOR_AQUISICAO: '0.00', DATA_VENCIMENTO_ORIGINAL: '', DATA_VENCIMENTO_AJUSTADA: '', DATA_EMISSAO: '', DATA_AQUISICAO: '', CHAVE_NFE: '-' };
    const ts = [
      { ...base, DOC_CEDENTE: '2', NU_DOCUMENTO: 'a', SEU_NUMERO: 'x', VALOR_PRESENTE: '1.00' },
      { ...base, DOC_CEDENTE: '1', NU_DOCUMENTO: 'a', SEU_NUMERO: 'x', VALOR_PRESENTE: '5.00' },
      { ...base, DOC_CEDENTE: '01', NU_DOCUMENTO: 'a', SEU_NUMERO: 'x', VALOR_PRESENTE: '7.00' },
    ];
    expect(deduplicar(ts).map((t) => t.VALOR_PRESENTE)).toEqual(['7.00', '1.00']);
    expect(deduplicar([...ts].reverse())).toEqual(deduplicar(ts));
  });
});

describe('liquidados e amostra anterior', () => {
  it('só as recompras, com o valor pago e meses por extenso', async () => {
    const csv = ['FUNDO;CEDENTE;IDENTIFICACAO_CEDENTE;DOCUMENTO;SEU_NUMERO;VALOR_PRESENTE;VALOR_PAGO;TIPO_MOVIMENTO;DATA_VENCIMENTO',
      'F;C;111;1;1;999,00;100,00;Recompra parcial;31-mar-2026',
      'F;C;111;2;2;999,00;200,00;Liquidação;31-mar-2026'].join('\n');
    const { recompras, avisos } = await lerLiquidados([{ nome: 'Liquidados.csv', conteudo: latin1(csv) }]);
    expect(avisos).toEqual([]);
    expect(recompras).toHaveLength(1);
    expect(recompras[0]).toMatchObject({ VALOR_PRESENTE: '100.00', DATA_VENCIMENTO_ORIGINAL: '2026-03-31' });
    const semRecompra = await lerLiquidados([{ nome: 'Liquidados.csv', conteudo: latin1(csv.split('\n').slice(0, 1).concat(csv.split('\n')[2]).join('\n')) }]);
    expect(semRecompra.avisos[0]).toMatch(/Não há recompras/);
  });

  it('chaves da amostra anterior, com a variante CCB', async () => {
    const csv = 'DOC_CEDENTE;NU_DOCUMENTO;SEU_NUMERO;TIPO_RECEBIVEL\n01.111;77;77;CCB\n222;8;9;DM\n';
    expect(await lerChavesAnteriores({ nome: 'anterior.csv', conteudo: latin1(csv) })).toEqual(['1111|77|77', '1111|77|CCB', '222|8|9']);
    await expect(lerChavesAnteriores({ nome: 'anterior.csv', conteudo: latin1('A;B\n1;2') })).rejects.toThrow(/DOC_CEDENTE, NU_DOCUMENTO e SEU_NUMERO/);
  });
});
