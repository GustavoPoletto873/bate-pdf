/**
 * Formas de impressão dos valores — o dicionário único da busca
 * (backend/services/formas_impressao.py).
 *
 * As duas pontas mudam juntas:
 * - as expressões que RECONHECEM o valor em qualquer texto (extrair*), usadas
 *   pelo motor em toda página;
 * - as formas em que um valor CONHECIDO costuma estar impresso
 *   (termosDeBusca), usadas pela busca de texto da tela (campos clicáveis).
 *
 * O texto chega normalizado (minúsculo, sem acento), com as quebras de linha
 * do PDF ("\r\n").
 */
import { D, ND, S, WS, digitosAscii, ehDigito, escapar, finditer, inteiro, lstrip, matchEm, re, split, strip, zfill } from './py';
import {
  type Data, type Moeda, ano as anoDe, criarData, deCentavos, dia as diaDe, formatarData, mes as mesDe, moedaDe,
  normalizarTexto, quantizar, textoDoValor,
} from './valores';

// ----------------------------------------------------------------------------
// Datas
// ----------------------------------------------------------------------------

export const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const NOME_DO_MES: Record<number, string> = Object.fromEntries(Object.entries(MESES).map(([n, i]) => [i, n]));
const MESES_ABREVIADOS: Record<string, number> = Object.fromEntries(Object.entries(MESES).map(([n, i]) => [n.slice(0, 3), i]));

const RE_DATA = re(`(?<!${D})(${D}{1,2})${S}?[/.\\-]${S}?(${D}{1,2})${S}?[/.\\-]${S}?(${D}{4}|${D}{2})(?!${D})`);
const FONTE_DATA_EXTENSO = `(?<!${D})(${D}{1,2})(?:º|°|o)?${S}+(?:\\([a-z ]{2,30}\\)${S}+)?de${S}+(${Object.keys(MESES).join('|')})${S}+de${S}+(${D}{4})(?!${D})`;
/** "15 de julho de 2026", "1º de julho de 2026", "15 (quinze) de julho de 2026". */
export const RE_DATA_EXTENSO = re(FONTE_DATA_EXTENSO);
/** RE_DATA_EXTENSO ancorada (o `.match(texto, pos)` do Python). */
export const RE_DATA_EXTENSO_Y = re(FONTE_DATA_EXTENSO, 'y');
const MES_ESCRITO = [...Object.keys(MESES), ...Object.keys(MESES_ABREVIADOS)]
  .sort((a, b) => b.length - a.length).join('|');
const HORA_EM_SEGUIDA = `(?![${WS},]*(?:as${S}+|\\()?${D}{1,2}:${D}{2})`;
const RE_DATA_MES_ESCRITO_Y = re(
  `(?<![${D}.])(${D}{1,2})${S}?([/\\-. ])${S}?(${MES_ESCRITO})\\.?${S}?[/\\-. ]${S}?(${D}{4}|${D}{2})(?!${D})${HORA_EM_SEGUIDA}`, 'y');
const RE_DATA_ISO = re(`(?<![${D}/.\\-])(${D}{4})-(${D}{2})-(${D}{2})(?!${D})`);

export function dataValida(diaN: number, mesN: number, anoN: number): Data | null {
  if (anoN < 100) anoN += 2000;
  const d = criarData(anoN, mesN, diaN);
  if (d === null) return null;
  const a = anoDe(d);
  return a >= 1900 && a <= 2100 ? d : null;
}

const TRECHO_DATA = re(`${D}[${D}./\\-${WS}]{4,}${D}`);
const TRECHO_MOEDA = re(`${D}[${D}.,\\r\\n]{2,}${D}`);
const TRECHO_DOCUMENTO = re(`${D}[${D}.,/\\-${WS}]{7,}${D}`);

function dentroDosTrechos(regex: RegExp, trechos: RegExp, texto: string): RegExpExecArray[] {
  const achados: RegExpExecArray[] = [];
  for (const t of finditer(trechos, texto)) {
    achados.push(...finditer(regex, texto, t.index, Math.min(texto.length, t.index + t[0].length + 1)));
  }
  return achados;
}

const PISTA_MES_ESCRITO = re(`${D}${S}?[/\\-. ]${S}?(?:${Object.keys(MESES_ABREVIADOS).join('|')})`);

function datasComMesEscrito(texto: string): [number, Data][] {
  const vistos = new Set<number>();
  const saida: [number, Data][] = [];
  for (const pista of finditer(PISTA_MES_ESCRITO, texto)) {
    const inicio = pista.index > 0 && ehDigito(texto[pista.index - 1]) ? pista.index - 1 : pista.index;
    const m = matchEm(RE_DATA_MES_ESCRITO_Y, texto, inicio);
    if (!m || vistos.has(m.index)) continue;
    vistos.add(m.index);
    const anoTxt = m[4];
    if (anoTxt.length === 2 && !'/-'.includes(m[2])) continue;
    const mesN = MESES[m[3]] || MESES_ABREVIADOS[m[3]];
    const d = dataValida(inteiro(m[1]), mesN, inteiro(anoTxt));
    if (d) saida.push([m.index, d]);
  }
  return saida;
}

function ordenarPorPosicao<T extends [number, ...unknown[]]>(lista: T[]): T[] {
  return lista.map((x, i) => [x, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map((e) => e[0]);
}

/** [(posição, data)] de todas as datas do texto, em qualquer forma. */
export function extrairDatas(texto: string): [number, Data][] {
  let datas: [number, Data][] = [];
  for (const trecho of finditer(TRECHO_DATA, texto)) {
    const inicio = trecho.index;
    const fim = Math.min(texto.length, trecho.index + trecho[0].length + 1);
    for (const m of finditer(RE_DATA, texto, inicio, fim)) {
      const d = dataValida(inteiro(m[1]), inteiro(m[2]), inteiro(m[3]));
      if (d) datas.push([m.index, d]);
    }
    if (trecho[0].includes('-')) {
      for (const m of finditer(RE_DATA_ISO, texto, inicio, fim)) {
        const d = dataValida(inteiro(m[3]), inteiro(m[2]), inteiro(m[1]));
        if (d) datas.push([m.index, d]);
      }
    }
  }
  for (const m of finditer(RE_DATA_EXTENSO, texto)) {
    const d = dataValida(inteiro(m[1]), MESES[m[2]], inteiro(m[3]));
    if (d) datas.push([m.index, d]);
  }
  datas.push(...datasComMesEscrito(texto));
  datas = ordenarPorPosicao(datas);
  return datas;
}

// ----------------------------------------------------------------------------
// Valores em dinheiro
// ----------------------------------------------------------------------------

const RE_MOEDA = re(`(?<![${D}.,])(${D}{1,3}(?:\\.${D}{3})+|${D}+)(?:\\r?\\n)?,(${D}{2})(?![${D},])`);
const RE_MOEDA_PONTO = re(`r\\$${S}*(${D}{1,3}(?:,${D}{3})+|${D}+)\\.(${D}{2})(?![${D}])`, 'd');
const RE_MOEDA_AMERICANA = re(`(?<![${D}.,])(${D}{1,3}(?:,${D}{3})+)\\.(${D}{2})(?![${D}.,])`, 'd');

/** [(posição, valor)] de todos os valores em dinheiro do texto. */
export function extrairMoedas(texto: string): [number, Moeda][] {
  const achados = new Map<number, Moeda>();
  const americanas: RegExpExecArray[] = [];
  for (const trecho of finditer(TRECHO_MOEDA, texto)) {
    const inicio = trecho.index;
    const fim = Math.min(texto.length, trecho.index + trecho[0].length + 1);
    for (const m of finditer(RE_MOEDA, texto, inicio, fim)) {
      achados.set(m.index, moedaDe(m[1].replace(/\./g, ''), m[2]));
    }
    if (trecho[0].includes('.') && trecho[0].includes(',')) americanas.push(...finditer(RE_MOEDA_AMERICANA, texto, inicio, fim));
  }
  for (const m of finditer(RE_MOEDA_PONTO, texto)) {
    const pos = m.indices![1][0];
    if (!achados.has(pos)) achados.set(pos, moedaDe(m[1].replace(/,/g, ''), m[2]));
  }
  for (const m of americanas) {
    const pos = m.indices![1][0];
    if (!achados.has(pos)) achados.set(pos, moedaDe(m[1].replace(/,/g, ''), m[2]));
  }
  return [...achados.entries()].sort((a, b) => a[0] - b[0]);
}

// ----------------------------------------------------------------------------
// CPF / CNPJ
// ----------------------------------------------------------------------------

const RE_PESSOA = re(
  `(?<!${D})(${D}{2}\\.?${D}{3}\\.?${D}{3}${S}{0,2}/?${S}{0,2}${D}{4}${S}{0,2}-?${S}{0,2}${D}{2}`
  + `|${D}{3}\\.?${D}{3}\\.?${D}{3}${S}{0,2}-?${S}{0,2}${D}{2})(?!${D})`);
const RE_DIGITOS_CORRIDOS = re(`(?<![${D}.,/\\-])(${D}{9,10}|${D}{12,13})(?![${D}.,/\\-])`);
const RE_NAO_DIGITO = re(ND);

/** `re.sub(r'\D', '', texto)`. */
export function soDigitos(texto: string): string {
  return texto.replace(RE_NAO_DIGITO, '');
}

/** [(posição, dígitos)] dos CPF/CNPJ do texto. */
export function extrairPessoas(texto: string): [number, string][] {
  const pessoas: [number, string][] = dentroDosTrechos(RE_PESSOA, TRECHO_DOCUMENTO, texto)
    .map((m) => [m.index, soDigitos(m[1])]);
  for (const m of dentroDosTrechos(RE_DIGITOS_CORRIDOS, TRECHO_DOCUMENTO, texto)) {
    pessoas.push([m.index, zfill(m[1], m[1].length <= 10 ? 11 : 14)]);
  }
  return ordenarPorPosicao(pessoas);
}

export function formatarPessoa(digitos: string): string {
  if (digitos.length === 11) return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
  if (digitos.length === 14) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
  }
  return digitos;
}

// ----------------------------------------------------------------------------
// Números de documento e códigos
// ----------------------------------------------------------------------------

const FONTE_NUMERO = `(?<!${D})${D}(?:[${D}./\\-]*${D})?(?!${D})`;
export const RE_NUMERO = re(FONTE_NUMERO);
/** RE_NUMERO ancorada. */
export const RE_NUMERO_Y = re(FONTE_NUMERO, 'y');
export const RE_DIGITOS = re(`${D}+`);
const RE_SO_DECIMAL = new RegExp(`^${D}+$`, 'u');

/** [posição, grupos sem zeros à esquerda, dígitos corridos sem zeros]. */
export type Numero = [number, string[], string];

export function extrairNumeros(texto: string): Numero[] {
  const numeros: Numero[] = [];
  for (const m of finditer(RE_NUMERO, texto)) {
    const numero = m[0];
    if (RE_SO_DECIMAL.test(numero)) {
      const corrido = lstrip(numero, '0') || '0';
      numeros.push([m.index, [corrido], corrido]);
      continue;
    }
    const partes = finditer(RE_DIGITOS, numero).map((p) => p[0]);
    numeros.push([m.index, partes.map((g) => lstrip(g, '0') || '0'), lstrip(partes.join(''), '0') || '0']);
  }
  return numeros;
}

const RE_CODIGO = re(`(?<![a-z0-9])(?=[a-z0-9\\-./]*[a-z])[a-z0-9]*${D}[a-z0-9]*(?:[\\-./][a-z0-9]+)*(?![a-z0-9])`);
export const MIN_CARACTERES_CODIGO = 6;
const RE_NAO_CODIGO = /[^a-z0-9]/g;
const RE_TEM_DIGITO = new RegExp(D, 'u');

export function compactarCodigo(texto: string | null | undefined): string | null {
  const compacto = (texto || '').replace(RE_NAO_CODIGO, '');
  if (compacto.length < MIN_CARACTERES_CODIGO || !/[a-z]/.test(compacto) || !RE_TEM_DIGITO.test(compacto)) return null;
  return compacto;
}

/** [(início, fim, código compactado)] dos tokens com letras E dígitos. */
export function extrairCodigos(texto: string): [number, number, string][] {
  const codigos: [number, number, string][] = [];
  for (const m of finditer(RE_CODIGO, texto)) {
    const compacto = compactarCodigo(m[0]);
    if (compacto) codigos.push([m.index, m.index + m[0].length, compacto]);
  }
  return codigos;
}

// ----------------------------------------------------------------------------
// Termos de busca: as formas impressas de um valor CONHECIDO
// ----------------------------------------------------------------------------

/** Formas que a busca da tela conhece. */
export const FORMAS = ['pessoa', 'moeda', 'data', 'numero', 'nome'] as const;
export type Forma = (typeof FORMAS)[number];
/** Formas cujo termo é um número: só vale sem estar colado em outro dígito (ver termoIsoladoEm). */
export const FORMAS_NUMERICAS: Forma[] = ['pessoa', 'moeda', 'data', 'numero'];
const MIN_CARACTERES_TERMO = 3;

const UNIDADES = ['', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DIA_POR_EXTENSO: Record<number, string> = {};
UNIDADES.forEach((n, i) => { if (i) DIA_POR_EXTENSO[i] = n; });
['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
  .forEach((n, i) => { DIA_POR_EXTENSO[10 + i] = n; });
UNIDADES.forEach((n, i) => { DIA_POR_EXTENSO[20 + i] = 'vinte' + (n ? ` e ${n}` : ''); });
DIA_POR_EXTENSO[30] = 'trinta';
DIA_POR_EXTENSO[31] = 'trinta e um';

function moedaDaTela(bruto: string): bigint | null {
  let texto = bruto.replace(new RegExp(`[^${D},.\\-]`, 'gu'), '');
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(/,/g, '.');
  else if (new RegExp(`^${D}{1,3}(?:\\.${D}{3})+$`, 'u').test(texto)) texto = texto.replace(/\./g, '');
  return quantizar(texto);
}

function dataDaTela(bruto: string): Data | null {
  const m = new RegExp(`^(${D}{4})-(${D}{2})-(${D}{2})`, 'u').exec(bruto);
  if (m) return dataValida(inteiro(m[3]), inteiro(m[2]), inteiro(m[1]));
  const datas = extrairDatas(normalizarTexto(bruto));
  return datas.length ? datas[0][1] : null;
}

function termosDePessoa(digitos: string): string[] {
  const termos = [formatarPessoa(digitos), digitos];
  if (digitos.length === 11) termos.push(formatarPessoa(digitos).slice(0, 11));
  else if (digitos.length === 14) termos.push(formatarPessoa(digitos).slice(0, 15));
  termos.push(lstrip(digitos, '0'));
  return termos;
}

/** `f'{n:,}'` de um inteiro em texto (com sinal opcional). */
function comMilhar(inteiroTxt: string): string {
  const negativo = inteiroTxt.startsWith('-');
  const corpo = negativo ? inteiroTxt.slice(1) : inteiroTxt;
  const grupos: string[] = [];
  for (let fim = corpo.length; fim > 0; fim -= 3) grupos.unshift(corpo.slice(Math.max(0, fim - 3), fim));
  return (negativo ? '-' : '') + grupos.join(',');
}

/** Inteiro e centavos de `f'{valor:.2f}'`. */
export function partesDaMoeda(valor: Moeda): [string, string] {
  const [i, c] = valor.split('.');
  return [i, c];
}

function termosDeMoeda(valor: Moeda): string[] {
  const [inteiroTxt, cent] = partesDaMoeda(valor);
  const milhar = comMilhar(String(BigInt(inteiroTxt)));
  return [`${milhar.replace(/,/g, '.')},${cent}`, `${inteiroTxt},${cent}`, `${milhar}.${cent}`, `${inteiroTxt}.${cent}`];
}

function termosDeData(d: Data): string[] {
  const nome = NOME_DO_MES[mesDe(d)];
  const curto = nome.slice(0, 3);
  const a = anoDe(d);
  const diaN = diaDe(d);
  const extenso = `de ${nome} de ${a}`;
  const termos = [formatarData(d, '/'), formatarData(d, '.'), formatarData(d, '-'), formatarData(d, '/', true), d,
    `${diaN} ${extenso}`];
  if (diaN === 1) termos.push(`1º ${extenso}`);
  termos.push(`(${DIA_POR_EXTENSO[diaN]}) ${extenso}`, `${diaN} de ${nome}, de ${a}`, `${diaN} ${curto} ${a}`,
    `${diaN} ${curto}. ${a}`, `${diaN}/${curto}/${a}`, `${diaN}/${curto}/${String(a % 100).padStart(2, '0')}`);
  return termos;
}

/**
 * Formas em que `valor` costuma estar impresso, da mais provável pra menos.
 * A busca de texto é substring literal (só caixa e acento são ignorados).
 * Moeda chega como "1613.33" e data como ISO, mas o digitado ("1.613,33",
 * "05/09/2026") também vale.
 */
export function termosDeBusca(forma: string, valor: unknown): string[] {
  const bruto = strip(lstrip(split(valor === null || valor === undefined ? '' : textoDoValor(valor)).join(' '), "'"));
  if (!bruto || bruto === '-') return [];
  let termos: string[];
  if (forma === 'pessoa') {
    let digitos = soDigitos(bruto);
    if (digitos.length === 10) digitos = zfill(digitos, 11);
    else if (digitos.length === 13) digitos = zfill(digitos, 14);
    termos = digitos ? termosDePessoa(digitos) : [bruto];
  } else if (forma === 'moeda') {
    const numero = moedaDaTela(bruto);
    termos = numero !== null ? termosDeMoeda(deCentavos(numero)) : [bruto];
  } else if (forma === 'data') {
    const d = dataDaTela(bruto);
    termos = d ? termosDeData(d) : [bruto];
  } else if (forma === 'numero') {
    const zeros = new RegExp(`^0+(?=${D})`, 'u');
    const semZeros = bruto.replace(zeros, '');
    const digitos = soDigitos(bruto).replace(zeros, '');
    termos = [bruto, semZeros, digitos.length >= 6 ? digitos : ''];
  } else {
    const palavras = bruto.split(' ');
    termos = [bruto, palavras.length > 2 ? palavras.slice(0, 2).join(' ') : ''];
  }
  const vistos = new Set<string>();
  const unicos: string[] = [];
  for (const t of termos) {
    const chave = normalizarTexto(t);
    if (t && [...t].length >= MIN_CARACTERES_TERMO && !vistos.has(chave)) {
      vistos.add(chave);
      unicos.push(t);
    }
  }
  return unicos;
}

/**
 * `termo` aparece em `texto` sem estar colado em outro dígito? Zeros à
 * esquerda valem ("05 de julho" é o dia 5); qualquer outro dígito não. Os
 * dois já normalizados.
 */
export function termoIsoladoEm(termo: string, texto: string): boolean {
  if (!termo) return false;
  const numeroNoInicio = ehDigito(termo[0]);
  const numeroNoFim = ehDigito(termo[termo.length - 1]);
  let i = texto.indexOf(termo);
  while (i >= 0) {
    let antes = i;
    if (numeroNoInicio) while (antes > 0 && texto[antes - 1] === '0') antes--;
    const fim = i + termo.length;
    const coladoAntes = numeroNoInicio && antes > 0 && ehDigito(texto[antes - 1]);
    const coladoDepois = numeroNoFim && fim < texto.length && ehDigito(texto[fim]);
    if (!coladoAntes && !coladoDepois) return true;
    i = texto.indexOf(termo, i + 1);
  }
  return false;
}

/** Atalho pros campos da amostra: a forma de busca de cada campo. */
export function formaDoCampo(campo: string): Forma {
  if (campo === 'sacado_documento' || campo === 'cedente_documento' || campo === 'doc_cessionario') return 'pessoa';
  if (campo === 'valor_total') return 'moeda';
  if (campo.startsWith('data_')) return 'data';
  if (campo === 'numero_documento') return 'numero';
  return 'nome';
}

/** Termos de busca de um campo da amostra (forma escolhida pelo campo). */
export function formasDeBusca(campo: string, valor: unknown): string[] {
  return termosDeBusca(formaDoCampo(campo), valor);
}

export { escapar, digitosAscii };
