import ExcelJS from 'exceljs';
import { WS } from '@/lib/motor/py';

/**
 * O pedaço do pandas 2.3 / openpyxl que a leitura do estoque do Bate Lastro usa
 * (backend/modules/amostragem/leitura.py), reproduzido em TypeScript:
 *
 * - `pd.read_csv(..., delimiter=";", encoding="latin1", dtype=str)`: tudo texto, os textos de "nulo"
 *   do pandas (NA, N/A, NULL, vazio…) viram NaN, aspas do CSV como o tokenizador em C;
 * - `pd.read_excel(engine="openpyxl")`: célula vazia vira NaN e cada coluna passa pela inferência de
 *   tipo do leitor (texto "00123" vira o número 123, como lá);
 * - as conversões de texto, valor (centavos, arredondamento do numpy) e data (`pd.to_datetime` com
 *   `dayfirst=True`, inclusive o formato adivinhado pelo primeiro valor da coluna).
 *
 * O que não dá para garantir igual ao pandas em todo caso (datas em formatos raros, que lá passam
 * pelo dateutil) está documentado em cada função. NaN é `null` aqui.
 */

export type Valor = string | number | boolean | Date | null;
/** Coluna lida: `numerica` = dtype numérico do pandas (int64/float64). */
export type Coluna = { nome: string; valores: Valor[]; numerica: boolean };
export type Quadro = { colunas: Coluna[]; linhas: number };

export class ErroDeLeitura extends Error {}

// ---------------------------------------------------------------------------
// Texto à moda do Python
// ---------------------------------------------------------------------------

const RE_BORDA = new RegExp(`^[${WS}]+|[${WS}]+$`, 'gu');
/** `str.strip()` do Python (o `trim` do JS tira ﻿ e não tira \x85). */
export function pyStrip(texto: string): string {
  return texto.replace(RE_BORDA, '');
}

/** Textos que o pandas lê como NaN (STR_NA_VALUES). */
export const NA_TEXTOS = new Set([
  '', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan', '1.#IND', '1.#QNAN',
  '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'None', 'n/a', 'nan', 'null',
]);

/** `repr(float)` do Python para números não inteiros. */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const [mant, expTxt] = x.toExponential().split('e');
  const exp = Number(expTxt);
  if (exp >= -4 && exp < 16) {
    const s = x.toString();
    if (!/e/i.test(s)) return Number.isInteger(x) ? `${s}.0` : s;
    return x.toFixed(Math.max(0, -exp + (mant.replace(/[-.]/g, '').length - 1)));
  }
  const sinal = exp < 0 ? '-' : '+';
  return `${mant}e${sinal}${String(Math.abs(exp)).padStart(2, '0')}`;
}

/** Inteiro exato de um float inteiro (`str(int(valor))`). */
function inteiroDe(x: number): string {
  return Number.isSafeInteger(x) ? String(x) : BigInt(x).toString();
}

function doisDigitos(n: number) {
  return String(n).padStart(2, '0');
}

/** `str(Timestamp)` do pandas, data em UTC (é como o ExcelJS entrega a data da célula). */
function textoDeData(d: Date): string {
  return `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())} ${doisDigitos(d.getUTCHours())}:${doisDigitos(d.getUTCMinutes())}:${doisDigitos(d.getUTCSeconds())}`;
}

/** `leitura.texto`: NaN → "-", float inteiro → inteiro, resto `str().strip()` ou "-". */
export function texto(v: Valor): string {
  if (v === null || (typeof v === 'number' && Number.isNaN(v))) return '-';
  if (typeof v === 'number') return Number.isInteger(v) ? inteiroDe(v) : pyFloatRepr(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v instanceof Date) return textoDeData(v);
  const r = pyStrip(String(v));
  return r || '-';
}

// ---------------------------------------------------------------------------
// Números (floatify / precise_xstrtod do pandas)
// ---------------------------------------------------------------------------

const ESPACO_ASCII = /[ \t\n\v\f\r]/;

/**
 * `floatify` do pandas: texto → número, com espaços nas pontas, sinal, expoente e inf/infinity.
 * Usa o mesmo algoritmo do `precise_xstrtod` (até 17 dígitos, depois × ou ÷ 10^k).
 * Devolve null quando o texto não é número. `inteiro` = sem ponto nem expoente.
 */
export function floatify(textoOriginal: string): { valor: number; inteiro: boolean } | null {
  const s = textoOriginal;
  let p = 0;
  while (p < s.length && ESPACO_ASCII.test(s[p])) p++;
  let negativo = false;
  if (s[p] === '-' || s[p] === '+') {
    negativo = s[p] === '-';
    p++;
  }
  let numero = 0;
  let expoente = 0;
  let digitos = 0;
  let inteiro = true;
  while (p < s.length && s[p] >= '0' && s[p] <= '9') {
    if (digitos < 17) {
      numero = numero * 10 + (s.charCodeAt(p) - 48);
      digitos++;
    } else expoente++;
    p++;
  }
  if (s[p] === '.') {
    inteiro = false;
    p++;
    let decimais = 0;
    while (p < s.length && digitos < 17 && s[p] >= '0' && s[p] <= '9') {
      numero = numero * 10 + (s.charCodeAt(p) - 48);
      p++;
      digitos++;
      decimais++;
    }
    while (p < s.length && s[p] >= '0' && s[p] <= '9') p++;
    expoente -= decimais;
  }
  const inf = () => {
    const t = s.trim().toLowerCase().replace(/^[+-]/, '');
    if (t === 'inf' || t === 'infinity') {
      const sinal = s.trim().startsWith('-') ? -1 : 1;
      return { valor: sinal * Infinity, inteiro: false };
    }
    return null;
  };
  if (digitos === 0) return inf();
  if (negativo) numero = -numero;
  if (s[p] === 'e' || s[p] === 'E') {
    const volta = p;
    p++;
    let negExp = false;
    if (s[p] === '-' || s[p] === '+') {
      negExp = s[p] === '-';
      p++;
    }
    let n = 0;
    let temDigito = false;
    while (p < s.length && s[p] >= '0' && s[p] <= '9') {
      n = n * 10 + (s.charCodeAt(p) - 48);
      p++;
      temDigito = true;
    }
    if (!temDigito) p = volta;
    else {
      expoente += negExp ? -n : n;
      inteiro = false;
    }
  }
  while (p < s.length && ESPACO_ASCII.test(s[p])) p++;
  if (p !== s.length) return inf();
  if (expoente > 308) return { valor: negativo ? -Infinity : Infinity, inteiro: false };
  if (expoente > 0) numero *= Number(`1e${expoente}`);
  else if (expoente < -308) numero = numero / Number('1e308') / Number(`1e${-expoente - 308}`);
  else if (expoente < 0) numero /= Number(`1e${-expoente}`);
  return { valor: numero, inteiro };
}

/** `pd.to_numeric(texto, errors="coerce")` → número ou NaN (null). */
export function paraNumero(textoNumero: string): number | null {
  const r = floatify(textoNumero);
  return r ? r.valor : null;
}

/** `np.round`: arredondamento meio para o par. */
export function arredondarParaPar(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Número → texto canônico em centavos ("-1234.50"); NaN/inf → "0.00" (`_coluna_valor`). */
export function centavosCanonicos(x: number | null): string {
  const n = x === null || !Number.isFinite(x) ? 0 : x;
  const c = BigInt(arredondarParaPar(n * 100) || 0);
  const abs = c < 0n ? -c : c;
  return `${c < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** `_coluna_valor`: coluna numérica como está; texto pela conversão brasileira (tira ponto, vírgula vira ponto). */
export function colunaValor(col: Coluna | undefined, linhas: number): string[] {
  if (!col) return Array(linhas).fill('0.00');
  return col.valores.map((v) => {
    if (v === null) return '0.00';
    if (typeof v === 'number') return centavosCanonicos(v);
    if (typeof v === 'boolean') return centavosCanonicos(v ? 1 : 0);
    if (typeof v === 'string') return centavosCanonicos(paraNumero(v.replace(/\./g, '').replace(/,/g, '.')));
    return '0.00';
  });
}

// ---------------------------------------------------------------------------
// Datas (pd.to_datetime(serie, errors="coerce", dayfirst=True))
// ---------------------------------------------------------------------------

const NAT_TEXTOS = new Set(['NaT', 'nat', 'NAT', 'nan', 'NaN', 'NAN']);
const MESES_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MESES_EN_LONGOS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function iso(ano: number, mes: number, dia: number): string | null {
  if (ano < 1 || ano > 9999 || mes < 1 || mes > 12 || dia < 1) return null;
  const d = new Date(Date.UTC(2000, mes - 1, dia));
  d.setUTCFullYear(ano);
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(ano).padStart(4, '0')}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

function isoDeDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Número numa coluna de data: o pandas lê como nanossegundos desde 1970. */
function isoDeNanossegundos(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  return isoDeDate(new Date(Math.floor(n / 1e6)));
}

const D = '(3[01]|[12]\\d|0[1-9]|[1-9]| [1-9])';
const M = '(1[0-2]|0[1-9]|[1-9])';
const Y = '(\\d\\d\\d\\d)';
const HORA = '(?:2[0-3]|[0-1]\\d|\\d)';
const MIN = '(?:[0-5]\\d|\\d)';
const SEG = '(?:6[0-1]|[0-5]\\d|\\d)';

/** Formato adivinhado: uma regex estrita (exact=True do pandas) e a ordem dos grupos. */
type Formato = { regex: RegExp; ordem: ('d' | 'm' | 'Y' | 'b')[] };

function escaparSep(sep: string) {
  return sep.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function sufixoDeHora(hora: string | undefined): string | null {
  if (!hora) return '';
  const m = /^([ T])(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(hora);
  if (!m) return null;
  const sep = m[1] === ' ' ? '\\s+' : 'T';
  return `${sep}${HORA}:${MIN}${m[4] !== undefined ? `:${SEG}` : ''}`;
}

/**
 * `guess_datetime_format(valor, dayfirst=True)` para as formas que aparecem nos estoques:
 * dia/mês/ano com / - ou . (com hora opcional), ano-mês-dia, AAAAMMDD e dia-mês por extenso
 * (inglês, como o strptime). Fora disso, null (o pandas cai no dateutil elemento a elemento).
 *
 * Divergência possível: com `dayfirst=True` o pandas 2.x pode adivinhar "%Y-%d-%m" para
 * "2026-03-05"; aqui ano-mês-dia é sempre lido como ISO.
 */
export function adivinharFormato(valor: string): Formato | null {
  let m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(.*)$/.exec(valor);
  if (m) {
    const a = Number(m[1]), b = Number(m[3]);
    const hora = sufixoDeHora(m[5] || undefined);
    if (hora === null) return null;
    const diaPrimeiro = a > 12 || b <= 12;
    const sep = escaparSep(m[2]);
    const formato: Formato = diaPrimeiro
      ? { regex: new RegExp(`^${D}${sep}${M}${sep}${Y}${hora}$`, 'i'), ordem: ['d', 'm', 'Y'] }
      : { regex: new RegExp(`^${M}${sep}${D}${sep}${Y}${hora}$`, 'i'), ordem: ['m', 'd', 'Y'] };
    return aplicarFormato(formato, valor) ? formato : null;
  }
  m = /^(\d{4})([/.-])(\d{1,2})\2(\d{1,2})(.*)$/.exec(valor);
  if (m) {
    const hora = sufixoDeHora(m[5] || undefined);
    if (hora === null) return null;
    const sep = escaparSep(m[2]);
    const formato: Formato = { regex: new RegExp(`^${Y}${sep}${M}${sep}${D}${hora}$`, 'i'), ordem: ['Y', 'm', 'd'] };
    return aplicarFormato(formato, valor) ? formato : null;
  }
  if (/^\d{8}$/.test(valor)) {
    const formato: Formato = { regex: new RegExp(`^${Y}${M}${D}$`), ordem: ['Y', 'm', 'd'] };
    return aplicarFormato(formato, valor) ? formato : null;
  }
  m = /^(\d{1,2})([/.\- ])([A-Za-z]{3,9})\2(\d{4})$/.exec(valor);
  if (m && mesPorNome(m[3]) !== null) {
    const sep = escaparSep(m[2]);
    const formato: Formato = { regex: new RegExp(`^${D}${sep}([A-Za-z]{3,9})${sep}${Y}$`, 'i'), ordem: ['d', 'b', 'Y'] };
    return aplicarFormato(formato, valor) ? formato : null;
  }
  return null;
}

function mesPorNome(nome: string): number | null {
  const n = nome.toLowerCase();
  const i = MESES_EN.indexOf(n);
  if (i >= 0) return i + 1;
  const j = MESES_EN_LONGOS.indexOf(n);
  return j >= 0 ? j + 1 : null;
}

function aplicarFormato(formato: Formato, valor: string): string | null {
  const m = formato.regex.exec(valor);
  if (!m) return null;
  let dia = 0, mes = 0, ano = 0;
  formato.ordem.forEach((o, i) => {
    const g = m[i + 1];
    if (o === 'd') dia = Number(g.trim());
    else if (o === 'm') mes = Number(g);
    else if (o === 'Y') ano = Number(g);
    else mes = mesPorNome(g) ?? 0;
  });
  return iso(ano, mes, dia);
}

/**
 * Um texto lido sem formato (o caminho elemento a elemento do pandas): ISO 8601 primeiro, depois a
 * data delimitada dia/mês/ano (`_parse_delimited_date`), e as formas comuns que o dateutil entende.
 */
export function dataSemFormato(valor: string): string | null {
  const s = valor.trim();
  if (!s || NAT_TEXTOS.has(s)) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})(?:T.*)?$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[ /\-\\.](\d{1,2})[ /\-\\.](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2];
    return a > 12 || b <= 12 ? iso(+m[3], b, a) : iso(+m[3], a, b);
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?)?$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2];
    const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return a > 12 || b <= 12 ? iso(ano, b, a) : iso(ano, a, b);
  }
  m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[ /.-]([A-Za-z]{3,9})[ /.-](\d{4})$/.exec(s);
  if (m) {
    const mes = mesPorNome(m[2]);
    return mes ? iso(+m[3], mes, +m[1]) : null;
  }
  return null;
}

/** `_coluna_data`: datas ISO ("" = NaT). */
export function colunaData(col: Coluna | undefined, linhas: number): string[] {
  if (!col) return Array(linhas).fill('');
  if (col.numerica) return col.valores.map((v) => (typeof v === 'number' ? isoDeNanossegundos(v) ?? '' : ''));
  const primeiro = col.valores.find((v) => v !== null && !(typeof v === 'string' && (v === '' || NAT_TEXTOS.has(v) || v === 'now' || v === 'today')));
  const formato = typeof primeiro === 'string' ? adivinharFormato(primeiro) : null;
  return col.valores.map((v) => {
    if (v === null) return '';
    if (v instanceof Date) return isoDeDate(v) ?? '';
    if (formato) {
      if (typeof v === 'string') return v === '' || NAT_TEXTOS.has(v) ? '' : aplicarFormato(formato, v) ?? '';
      return aplicarFormato(formato, texto(v)) ?? '';
    }
    if (typeof v === 'number') return isoDeNanossegundos(v) ?? '';
    if (typeof v === 'string') return dataSemFormato(v) ?? '';
    return '';
  });
}

// ---------------------------------------------------------------------------
// Leitura dos arquivos
// ---------------------------------------------------------------------------

/** Bytes → texto em latin1 do Python (0x80–0x9F viram controles, não o cp1252 do navegador). */
export function decodificarLatin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

/** Tokenizador de CSV do pandas (C): `;`, aspas duplas, \n \r\n \r, linhas em branco puladas. */
export function tokenizarCsv(textoCsv: string, delimitador = ';'): string[][] {
  const linhas: string[][] = [];
  let campos: string[] = [];
  let campo = '';
  let estado: 'inicio_linha' | 'inicio' | 'campo' | 'aspas' | 'aspas_em_aspas' | 'linha_branca' = 'inicio_linha';
  let brancos = '';
  const fimDeCampo = () => {
    campos.push(campo);
    campo = '';
  };
  const fimDeLinha = () => {
    fimDeCampo();
    linhas.push(campos);
    campos = [];
    estado = 'inicio_linha';
  };
  for (let i = 0; i <= textoCsv.length; i++) {
    const c = i < textoCsv.length ? textoCsv[i] : null;
    if (c === null) {
      if (estado === 'aspas' || estado === 'aspas_em_aspas' || estado === 'campo' || estado === 'inicio') fimDeLinha();
      break;
    }
    const quebra = c === '\n' || c === '\r';
    if (quebra && c === '\r' && textoCsv[i + 1] === '\n' && estado !== 'aspas') i++;
    switch (estado) {
      case 'inicio_linha':
        if (quebra) break;
        if ((c === ' ' || c === '\t') && c !== delimitador) {
          estado = 'linha_branca';
          brancos = c;
          break;
        }
        estado = 'inicio';
        i--;
        break;
      case 'linha_branca':
        if (quebra) {
          estado = 'inicio_linha';
          brancos = '';
        } else if (c === ' ' || c === '\t') brancos += c;
        else {
          campo = brancos;
          brancos = '';
          estado = 'campo';
          i--;
        }
        break;
      case 'inicio':
        if (c === '"') estado = 'aspas';
        else if (c === delimitador) fimDeCampo();
        else if (quebra) fimDeLinha();
        else {
          campo += c;
          estado = 'campo';
        }
        break;
      case 'campo':
        if (c === delimitador) {
          fimDeCampo();
          estado = 'inicio';
        } else if (quebra) fimDeLinha();
        else campo += c;
        break;
      case 'aspas':
        if (c === '"') estado = 'aspas_em_aspas';
        else campo += c === '\r' && textoCsv[i + 1] === '\n' ? '\r' : c;
        break;
      case 'aspas_em_aspas':
        if (c === '"') {
          campo += '"';
          estado = 'aspas';
        } else if (c === delimitador) {
          fimDeCampo();
          estado = 'inicio';
        } else if (quebra) fimDeLinha();
        else {
          campo += c;
          estado = 'campo';
        }
        break;
    }
  }
  return linhas;
}

/** Nomes repetidos ganham ".1", ".2"… (como o pandas), depois `str(c).strip()`. */
function nomesDasColunas(cabecalho: string[]): string[] {
  const vistos = new Map<string, number>();
  const usados = new Set<string>();
  const nomes = cabecalho.map((nome) => {
    let n = nome;
    const cont = vistos.get(nome) ?? 0;
    if (cont > 0) {
      let k = cont;
      while (usados.has(`${nome}.${k}`)) k++;
      n = `${nome}.${k}`;
      vistos.set(nome, k + 1);
    } else vistos.set(nome, 1);
    usados.add(n);
    return n;
  });
  return nomes.map((n) => pyStrip(n));
}

/** `pd.read_csv(..., delimiter=";", encoding="latin1", dtype=str)`. */
export function lerCsv(bytes: Uint8Array): Quadro {
  const linhas = tokenizarCsv(decodificarLatin1(bytes));
  if (!linhas.length) throw new ErroDeLeitura('CSV vazio');
  const cabecalho = linhas[0].map((c, i) => (c === '' ? `Unnamed: ${i}` : c));
  let dados = linhas.slice(1);
  const n = cabecalho.length;
  // Primeira linha com um campo a mais: o pandas usa a primeira coluna como índice.
  const comIndice = dados.length > 0 && dados[0].length === n + 1;
  if (comIndice) dados = dados.map((l) => l.slice(1));
  dados.forEach((l, i) => {
    if (l.length > n) throw new ErroDeLeitura(`Expected ${n} fields in line ${i + 2}, saw ${l.length}`);
  });
  const nomes = nomesDasColunas(cabecalho);
  const colunas: Coluna[] = nomes.map((nome, j) => ({
    nome,
    numerica: false,
    valores: dados.map((l) => {
      const v = l[j];
      return v === undefined || NA_TEXTOS.has(v) ? null : v;
    }),
  }));
  return { colunas, linhas: dados.length };
}

function valorDaCelulaExcel(v: unknown): Valor | '' {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('error' in o) return null;
    if ('result' in o) return valorDaCelulaExcel(o.result);
    if ('formula' in o || 'sharedFormula' in o) return '';
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((p) => p.text).join('');
    if ('text' in o) return valorDaCelulaExcel(o.text);
  }
  return String(v);
}

const VERDADEIROS = new Set(['True', 'TRUE', 'true']);
const FALSOS = new Set(['False', 'FALSE', 'false']);
const INT64_MIN = -(2n ** 63n);
const UINT64_MAX = 2n ** 64n - 1n;

/** Inferência de tipo do leitor do pandas para uma coluna do Excel (`_infer_types`). */
export function inferirColuna(nome: string, brutos: (Valor | '')[]): Coluna {
  const semNa: Valor[] = brutos.map((v) => (v === '' || (typeof v === 'string' && NA_TEXTOS.has(v)) ? null : v));
  let numerica = true;
  const numeros: (number | null)[] = [];
  for (const v of semNa) {
    if (v === null) numeros.push(null);
    else if (typeof v === 'number') numeros.push(v);
    else if (typeof v === 'string') {
      const r = floatify(v);
      if (!r) { numerica = false; break; }
      if (r.inteiro) {
        let big: bigint | null = null;
        try { big = BigInt(v.trim()); } catch { big = null; }
        if (big !== null && (big < INT64_MIN || big > UINT64_MAX)) { numerica = false; break; }
      }
      numeros.push(r.valor);
    } else { numerica = false; break; }
  }
  if (numerica) return { nome, numerica: true, valores: numeros };
  const naoNulos = semNa.filter((v) => v !== null);
  if (naoNulos.length && naoNulos.every((v) => typeof v === 'boolean' || (typeof v === 'string' && (VERDADEIROS.has(v) || FALSOS.has(v))))) {
    return { nome, numerica: false, valores: semNa.map((v) => (v === null ? null : typeof v === 'boolean' ? v : VERDADEIROS.has(v as string))) };
  }
  return { nome, numerica: false, valores: semNa };
}

function nomeDoCabecalho(v: Valor | '', i: number): string {
  if (v === '' || v === null) return `Unnamed: ${i}`;
  if (typeof v === 'number') return Number.isInteger(v) ? inteiroDe(v) : pyFloatRepr(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v instanceof Date) return textoDeData(v);
  return v;
}

/** Linhas cruas da primeira aba, como o leitor openpyxl do pandas (vazio = ""). */
export async function linhasDoExcel(bytes: Uint8Array, limite?: number): Promise<(Valor | '')[][]> {
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const aba = livro.worksheets[0];
  if (!aba) return [];
  const dados: (Valor | '')[][] = [];
  let ultima = -1;
  aba.eachRow({ includeEmpty: true }, (linha, numero) => {
    if (limite !== undefined && dados.length >= limite) return;
    while (dados.length < numero - 1) dados.push([]);
    const valores = (linha.values as unknown[]).slice(1);
    const convertida: (Valor | '')[] = [];
    for (let i = 0; i < valores.length; i++) convertida.push(valorDaCelulaExcel(valores[i]));
    while (convertida.length && convertida[convertida.length - 1] === '') convertida.pop();
    if (convertida.length) ultima = dados.length;
    dados.push(convertida);
  });
  return dados.slice(0, ultima + 1);
}

/** `pd.read_excel(conteudo, engine="openpyxl")` (primeira aba, cabeçalho na linha 1). */
export async function lerXlsx(bytes: Uint8Array): Promise<Quadro> {
  const dados = await linhasDoExcel(bytes);
  if (!dados.length) return { colunas: [], linhas: 0 };
  const largura = Math.max(...dados.map((l) => l.length));
  const [cabecalho, ...corpo] = dados.map((l) => [...l, ...Array(largura - l.length).fill('')]);
  const nomes = nomesDasColunas(cabecalho.map(nomeDoCabecalho));
  const colunas = nomes.map((nome, j) => inferirColuna(nome, corpo.map((l) => l[j])));
  return { colunas, linhas: corpo.length };
}
