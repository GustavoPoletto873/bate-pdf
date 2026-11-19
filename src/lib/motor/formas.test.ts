/** Porta de backend/tests/test_formas_impressao.py. */
import { describe, expect, test } from 'vitest';
import { extrairCodigos, extrairDatas, extrairMoedas, extrairNumeros, extrairPessoas, termoIsoladoEm, termosDeBusca } from './formas';
import { ehAlnum, lstrip, zfill } from './py';
import { normalizarTexto } from './valores';

const IMPRESSOS: [string, string, string][] = [
  ['data', '2026-09-05', '05/09/2026'],
  ['data', '2026-09-05', '05.09.2026'],
  ['data', '2026-09-05', '05-09-2026'],
  ['data', '2026-09-05', '05/09/26'],
  ['data', '2026-09-05', 'assinado em 2026-09-05t14:32:10'],
  ['data', '2026-09-05', '5 de setembro de 2026'],
  ['data', '2026-09-05', '05 de Setembro de 2026'],
  ['data', '2026-07-01', '1º de julho de 2026'],
  ['data', '2026-07-15', '15 (quinze) de julho de 2026'],
  ['data', '2026-07-01', '1 (um) de julho de 2026'],
  ['data', '2026-07-15', '15 jul 2026'],
  ['data', '2026-07-15', '15/jul/2026'],
  ['data', '2026-07-15', '15/JUL/26'],
  ['moeda', '1613.33', 'R$ 1.613,33'],
  ['moeda', '1613.33', 'valor 1613,33'],
  ['moeda', '285.10', 'R$ 285,10'],
  ['moeda', '1613.33', 'R$ 1613.33'],
  ['moeda', '1380.65', 'R$ 1,380.65'],
  ['moeda', '1380.65', 'total 1,380.65 usd'],
  ['pessoa', '123.456.789-09', 'CPF 123.456.789-09'],
  ['pessoa', '123.456.789-09', 'CPF 12345678909'],
  ['pessoa', '12345678909', 'CPF: 123.456.789-\r\n09'],
  ['pessoa', '11.222.333/0001-81', 'CNPJ 11.222.333/0001-81'],
  ['pessoa', '11222333000181', 'CNPJ/MF 11222333000181'],
  ['pessoa', '11.222.333/0001-81', 'CNPJ 11.222.333/0001\r\n-81'],
  ['pessoa', '1234567890', 'CPF 012.345.678-90'],
  ['pessoa', '012.345.678-90', 'cpf 1234567890 valor'],
  ['numero', '52635-01', 'DUPLICATA 52635-01'],
  ['numero', "'0052635-01", 'nº 52635-01'],
  ['numero', '8638376301', 'CCB Nº 8638376301'],
  ['numero', '12C3-45678', 'ccb nº 12C3-45678'],
];

const SO_O_MOTOR: [string, string, string][] = [
  ['moeda', '12345.67', 'valor 12.345\r\n,67 vencimento'],
  ['data', '2026-07-15', '15 jul. 2026'],
  ['data', '2026-07-15', '15-julho-2026'],
  ['data', '2026-07-15', '15 julho 2026'],
];

const SO_A_BUSCA: [string, string, string][] = [
  ['data', '2026-06-15', 'São Paulo, 15 de junho, de 2026'],
  ['data', '2026-06-15', 'assinado em 15 jun. 2026, 10:42:13'],
  ['data', '2026-06-15', 'Assinado em 15 jun 2026 às 10:42'],
];

function reconhecido(forma: string, valor: string, texto: string): boolean {
  if (forma === 'data') return extrairDatas(texto).some(([, d]) => d === valor);
  if (forma === 'moeda') return extrairMoedas(texto).some(([, v]) => v === valor);
  if (forma === 'pessoa') {
    let digitos = valor.replace(/\D/g, '');
    digitos = zfill(digitos, digitos.length <= 11 ? 11 : 14);
    return extrairPessoas(texto).some(([, d]) => d === digitos);
  }
  if (forma === 'numero') {
    const compacto = lstrip([...normalizarTexto(valor)].filter(ehAlnum).join(''), '0');
    if (/[a-z]/.test(compacto)) return extrairCodigos(texto).some(([, , c]) => c === compacto);
    return extrairNumeros(texto).some(([, , corrido]) => corrido === compacto);
  }
  throw new Error(forma);
}

describe('formas de impressão', () => {
  test.each(IMPRESSOS)('motor reconhece e busca acha: %s %s %s', (forma, valor, impresso) => {
    const texto = normalizarTexto(`linha de cima\r\n${impresso}\r\nlinha de baixo`);
    expect(reconhecido(forma, valor, texto), `o motor não reconhece ${impresso}`).toBe(true);
    const termos = termosDeBusca(forma, valor);
    expect(termos.some((t) => termoIsoladoEm(normalizarTexto(t), texto)), `nenhum termo ${termos} acha ${impresso}`).toBe(true);
  });

  test.each(SO_A_BUSCA)('só a busca acha: %s %s %s', (forma, valor, impresso) => {
    const texto = normalizarTexto(impresso);
    expect(reconhecido(forma, valor, texto)).toBe(false);
    expect(termosDeBusca(forma, valor).some((t) => termoIsoladoEm(normalizarTexto(t), texto))).toBe(true);
  });

  test.each(SO_O_MOTOR)('só o motor reconhece: %s %s %s', (forma, valor, impresso) => {
    const texto = normalizarTexto(impresso);
    if (forma === 'data') expect(extrairDatas(texto).map(([, d]) => d)).toContain(valor);
    else expect(extrairMoedas(texto).map(([, v]) => v)).toContain(valor);
  });

  test('termos de cada forma na ordem', () => {
    expect(termosDeBusca('pessoa', '1234567890')).toEqual(['012.345.678-90', '01234567890', '012.345.678', '1234567890']);
    expect(termosDeBusca('pessoa', '11.222.333/0001-81')).toEqual(['11.222.333/0001-81', '11222333000181', '11.222.333/0001']);
    expect(termosDeBusca('moeda', '1613.33')).toEqual(['1.613,33', '1613,33', '1,613.33', '1613.33']);
    expect(termosDeBusca('moeda', '285.1')).toEqual(['285,10', '285.10']);
    expect(termosDeBusca('moeda', 'R$ 1.613,33')[0]).toBe('1.613,33');
    expect(termosDeBusca('moeda', '1.613')[0]).toBe('1.613,00');
    expect(termosDeBusca('data', '2026-09-05T00:00:00')).toEqual([
      '05/09/2026', '05.09.2026', '05-09-2026', '05/09/26', '2026-09-05', '5 de setembro de 2026',
      '(cinco) de setembro de 2026', '5 de setembro, de 2026', '5 set 2026', '5 set. 2026', '5/set/2026', '5/set/26']);
    expect(termosDeBusca('data', '05/09/2026')[0]).toBe('05/09/2026');
    expect(termosDeBusca('data', '2026-07-01')).toContain('1º de julho de 2026');
    expect(termosDeBusca('data', '2026-07-21')).toContain('(vinte e um) de julho de 2026');
    expect(termosDeBusca('numero', "'0052635-01")).toEqual(['0052635-01', '52635-01', '5263501']);
    expect(termosDeBusca('nome', 'MARIA  APARECIDA LIMA')).toEqual(['MARIA APARECIDA LIMA', 'MARIA APARECIDA']);
    expect(termosDeBusca('moeda', null)).toEqual([]);
    expect(termosDeBusca('data', '-')).toEqual([]);
  });

  test('termo não vale colado em outro dígito', () => {
    expect(termoIsoladoEm('1 de julho de 2026', 'em 1 de julho de 2026')).toBe(true);
    expect(termoIsoladoEm('5 de setembro de 2026', 'em 05 de setembro de 2026')).toBe(true);
    expect(termoIsoladoEm('52635-01', 'nº 0052635-01')).toBe(true);
    expect(termoIsoladoEm('1 de julho de 2026', 'em 21 de julho de 2026')).toBe(false);
    expect(termoIsoladoEm('1.613,33', 'r$ 21.613,33')).toBe(false);
    expect(termoIsoladoEm('12345678909', 'cod 1234567890912')).toBe(false);
    expect(termoIsoladoEm('05/09/26', 'em 05/09/267')).toBe(false);
    expect(termoIsoladoEm('1.613,33', 'r$ 21.613,33 e r$ 1.613,33')).toBe(true);
    expect(termoIsoladoEm('maria', 'xmariax')).toBe(true);
  });

  test('não reconhece o que não é valor', () => {
    expect(extrairDatas('15 mar 26')).toEqual([]);
    expect(extrairDatas('processo 2026-07-45')).toEqual([]);
    expect(extrairMoedas('codigo 1613.33')).toEqual([]);
    expect(extrairDatas('15 julia 2026')).toEqual([]);
  });
});
