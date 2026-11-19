/**
 * Texto normalizado, datas e dinheiro — os tipos de valor do motor.
 *
 * - Datas são strings ISO 'AAAA-MM-DD' (o motor só compara, soma dias e
 *   meses; a ordem da string é a cronológica).
 * - Dinheiro é a string canônica do Decimal com 2 casas ('1613.33', sem zeros
 *   à esquerda): igualdade de string = igualdade de valor, sem float.
 */
import { digitosAscii, strip } from './py';

// ----------------------------------------------------------------------------
// Texto (utils/texto_normalizado.py)
// ----------------------------------------------------------------------------

const TABELA = new Map<number, string>();
const ASCII = /^[\x00-\x7f]*$/;

function normalizarCaractere(c: string, cp: number): string {
  let n = TABELA.get(cp);
  if (n === undefined) {
    const decomposto = c.normalize('NFD');
    const base = decomposto ? String.fromCodePoint(decomposto.codePointAt(0)!) : c;
    n = base.toLowerCase();
    TABELA.set(cp, n);
  }
  return n;
}

/** Sem acento e minúsculo, preservando o comprimento (mesmo resultado do Python). */
export function normalizarTexto(texto: string | null | undefined): string {
  if (!texto) return '';
  if (ASCII.test(texto)) return texto.toLowerCase();
  const partes: string[] = [];
  for (const c of texto) {
    const cp = c.codePointAt(0)!;
    partes.push(cp < 128 ? c.toLowerCase() : normalizarCaractere(c, cp));
  }
  return partes.join('');
}

// ----------------------------------------------------------------------------
// Datas
// ----------------------------------------------------------------------------

export type Data = string;

function bissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

export function diasNoMes(ano: number, mes: number): number {
  return [31, bissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
}

/** `date(ano, mes, dia).isoformat()`, ou null onde o Python levantaria ValueError. */
export function criarData(ano: number, mes: number, dia: number): Data | null {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia)) return null;
  if (ano < 1 || ano > 9999 || mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) return null;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function ano(d: Data): number {
  return parseInt(d.slice(0, 4), 10);
}

export function mes(d: Data): number {
  return parseInt(d.slice(5, 7), 10);
}

export function dia(d: Data): number {
  return parseInt(d.slice(8, 10), 10);
}

function paraDias(d: Data): number {
  const t = new Date(0);
  t.setUTCFullYear(ano(d), mes(d) - 1, dia(d));
  return Math.round(t.getTime() / 86400000);
}

function deDias(n: number): Data {
  const t = new Date(n * 86400000);
  return criarData(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())!;
}

/** `d + timedelta(days=n)`. */
export function somarDias(d: Data, n: number): Data {
  return deDias(paraDias(d) + n);
}

/** `d.weekday()`: segunda = 0. */
export function diaDaSemana(d: Data): number {
  const t = new Date(paraDias(d) * 86400000);
  return (t.getUTCDay() + 6) % 7;
}

/** `d.strftime('%d/%m/%Y')` e afins: `sep` entre os campos, ano com 4 ou 2 dígitos. */
export function formatarData(d: Data, sep = '/', anoCurto = false): string {
  const a = anoCurto ? d.slice(2, 4) : d.slice(0, 4);
  return `${d.slice(8, 10)}${sep}${d.slice(5, 7)}${sep}${a}`;
}

/** `date.fromisoformat` nas formas que a amostra usa ('AAAA-MM-DD' e 'AAAAMMDD'). */
export function deIso(texto: string): Data | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(texto);
  if (!m) return null;
  return criarData(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
}

// ----------------------------------------------------------------------------
// Dinheiro (Decimal com 2 casas)
// ----------------------------------------------------------------------------

export type Moeda = string;

const ZERO = BigInt(0);
const CEM = BigInt(100);
const DEZ = BigInt(10);
// Precisão do contexto padrão do Decimal: quantize com mais dígitos que isso é InvalidOperation.
const PRECISAO = 28;

/** Centavos (BigInt) da string canônica. */
export function centavos(m: Moeda): bigint {
  const negativo = m.startsWith('-');
  const [i, c] = (negativo ? m.slice(1) : m).split('.');
  const v = BigInt(i) * CEM + BigInt(c);
  return negativo ? -v : v;
}

/** String canônica de centavos. */
export function deCentavos(c: bigint): Moeda {
  const negativo = c < ZERO;
  const abs = negativo ? -c : c;
  const inteiro = (abs / CEM).toString();
  const resto = (abs % CEM).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${inteiro}.${resto}`;
}

/** Moeda a partir da parte inteira e dos centavos impressos ("0012", "30" → "12.30"). */
export function moedaDe(inteiroDigitos: string, centavosDigitos: string): Moeda {
  const i = digitosAscii(inteiroDigitos).replace(/^0+(?=\d)/, '');
  return `${i || '0'}.${digitosAscii(centavosDigitos)}`;
}

export function moedaPositiva(m: Moeda): boolean {
  return centavos(m) > ZERO;
}

const RE_DECIMAL = /^([+-])?(\d+(?:_\d+)*)?(?:\.(\d+(?:_\d+)*)?)?(?:[eE]([+-]?\d+(?:_\d+)*))?$/;

/**
 * `Decimal(texto).quantize(Decimal('0.01'))` em centavos (arredondamento
 * meio-pro-par, o padrão do Decimal); null onde o Python levantaria
 * InvalidOperation (texto que não é número, infinito/NaN, dígitos demais).
 */
export function quantizar(texto: string): bigint | null {
  const limpo = digitosAscii(strip(texto));
  const m = RE_DECIMAL.exec(limpo);
  if (!m || (m[2] === undefined && m[3] === undefined)) return null;
  const inteiro = (m[2] ?? '').replace(/_/g, '');
  const fracao = (m[3] ?? '').replace(/_/g, '');
  const expoente = (m[4] ? parseInt(m[4].replace(/_/g, ''), 10) : 0) - fracao.length;
  let coef = BigInt((inteiro + fracao) || '0');
  // valor = coef * 10^expoente; quero centavos = valor * 100.
  const deslocamento = expoente + 2;
  if (deslocamento >= 0) {
    if (deslocamento > 60) return null;
    coef *= DEZ ** BigInt(deslocamento);
  } else {
    const divisor = DEZ ** BigInt(-deslocamento);
    const q = coef / divisor;
    const r = coef % divisor;
    const dobro = r * BigInt(2);
    coef = dobro > divisor || (dobro === divisor && q % BigInt(2) !== ZERO) ? q + BigInt(1) : q;
  }
  if (coef.toString().length > PRECISAO) return null;
  return m[1] === '-' ? -coef : coef;
}

/** Valor da tela/amostra como o motor vê: str(valor) do Python. */
export function textoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined) return 'None';
  if (typeof valor === 'boolean') return valor ? 'True' : 'False';
  return String(valor);
}
