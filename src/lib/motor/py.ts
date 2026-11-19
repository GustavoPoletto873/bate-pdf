/**
 * Semântica do Python que o motor precisa reproduzir em JS.
 *
 * O motor original (backend/services/pre_classificacao_service.py) roda em
 * Python, onde `re` sobre str é Unicode (\s, \d, \w, \b), `str.split()` corta
 * em qualquer espaço Unicode, `finditer(texto, pos, endpos)` deixa o
 * lookbehind ver antes de `pos` e esconde o que vem depois de `endpos`, e
 * `$` casa também antes de uma quebra de linha final. Tudo aqui existe pra
 * que a tradução linha a linha dê o mesmo resultado.
 *
 * As regexes são montadas com `new RegExp(fonte, flags)` (não literais): o
 * tsconfig do app mira ES2017 e o TypeScript recusaria lookbehind e a flag
 * `d` em literal.
 */

/** Conteúdo de classe equivalente ao `\s` do Python (str.isspace). */
export const WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
/** `\s` do Python. */
export const S = `[${WS}]`;
/** `\S` do Python. */
export const NS = `[^${WS}]`;
/** `\d` do Python (qualquer dígito decimal Unicode). Precisa da flag `u`. */
export const D = '\\p{Nd}';
/** `\D` do Python. */
export const ND = '\\P{Nd}';
/** `\w` do Python: letras, números e `_`. */
export const WC = '\\p{L}\\p{N}_';
/** `\b` do Python. */
export const B = `(?:(?<=[${WC}])(?![${WC}])|(?<![${WC}])(?=[${WC}]))`;

const RE_ESPACO = new RegExp(S, 'u');
const RE_ESPACOS_SPLIT = new RegExp(`${S}+`, 'u');
const RE_ND = new RegExp(`^${D}$`, 'u');
const RE_ALNUM = /^[\p{L}\p{N}]$/u;

/** Regex com as flags de busca do Python (`g` pra iterar, `u` pras classes Unicode). */
export function re(fonte: string, extra = ''): RegExp {
  return new RegExp(fonte, `gu${extra}`);
}

/** `re.escape`. */
export function escapar(texto: string): string {
  // Só os caracteres de sintaxe: na flag `u`, escapar "-" fora de classe é erro.
  return texto.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * `regex.finditer(texto, pos, endpos)` — todas as ocorrências, como lista.
 * O lookbehind enxerga antes de `pos`; nada depois de `endpos` existe.
 */
export function finditer(regex: RegExp, texto: string, pos = 0, endpos?: number): RegExpExecArray[] {
  const fim = endpos === undefined ? texto.length : Math.max(0, Math.min(endpos, texto.length));
  const alvo = fim < texto.length ? texto.slice(0, fim) : texto;
  const achados: RegExpExecArray[] = [];
  if (pos > alvo.length) return achados;
  regex.lastIndex = Math.max(0, pos);
  for (;;) {
    const m = regex.exec(alvo);
    if (!m) break;
    achados.push(m);
    if (m[0].length === 0) {
      if (m.index >= alvo.length) break;
      regex.lastIndex = m.index + 1;
    }
  }
  regex.lastIndex = 0;
  return achados;
}

/** `regex.search(texto, pos, endpos)`. */
export function search(regex: RegExp, texto: string, pos = 0, endpos?: number): RegExpExecArray | null {
  const fim = endpos === undefined ? texto.length : Math.max(0, Math.min(endpos, texto.length));
  const alvo = fim < texto.length ? texto.slice(0, fim) : texto;
  if (pos > alvo.length) return null;
  regex.lastIndex = Math.max(0, pos);
  const m = regex.exec(alvo);
  regex.lastIndex = 0;
  return m;
}

/** `regex.match(texto, pos, endpos)` — ancorado em `pos`. A regex tem que ter a flag `y`. */
export function matchEm(regex: RegExp, texto: string, pos = 0, endpos?: number): RegExpExecArray | null {
  if (!regex.sticky) throw new Error('matchEm precisa de regex com a flag y');
  return search(regex, texto, pos, endpos);
}

/** `re.findall` de uma regex sem grupos. */
export function findall(regex: RegExp, texto: string): string[] {
  return finditer(regex, texto).map((m) => m[0]);
}

/** `str.split()` sem argumento: corta em qualquer sequência de espaços, sem vazios. */
export function split(texto: string): string[] {
  if (!texto) return [];
  return texto.split(RE_ESPACOS_SPLIT).filter((p) => p.length > 0);
}

/** `str.strip()` sem argumento. */
export function strip(texto: string): string {
  let ini = 0;
  let fim = texto.length;
  while (ini < fim && RE_ESPACO.test(texto[ini])) ini++;
  while (fim > ini && RE_ESPACO.test(texto[fim - 1])) fim--;
  return texto.slice(ini, fim);
}

/** `str.lstrip(chars)`. */
export function lstrip(texto: string, chars: string): string {
  let i = 0;
  while (i < texto.length && chars.includes(texto[i])) i++;
  return texto.slice(i);
}

/** `str.zfill(n)` (sem sinal). */
export function zfill(texto: string, n: number): string {
  return texto.length >= n ? texto : '0'.repeat(n - texto.length) + texto;
}

/** `str.isspace()` de 1 caractere. */
export function ehEspaco(c: string): boolean {
  return RE_ESPACO.test(c);
}

/** `str.isdecimal()` de 1 caractere. */
export function ehDecimal(c: string): boolean {
  return RE_ND.test(c);
}

// Numeric_Type=Digit (fora os decimais): sobrescritos, subscritos, circulados...
const DIGITOS_EXTRA = new RegExp(
  '^[\\u00b2\\u00b3\\u00b9\\u2070\\u2074-\\u2079\\u2080-\\u2089\\u2460-\\u2468\\u2474-\\u247c\\u2488-\\u2490'
  + '\\u24ea\\u24f5-\\u24fd\\u24ff\\u2776-\\u277e\\u2780-\\u2788\\u278a-\\u2792\\u1369-\\u1371\\u19da]$', 'u');

/** `str.isdigit()` de 1 caractere. */
export function ehDigito(c: string | undefined): boolean {
  if (!c) return false;
  return RE_ND.test(c) || DIGITOS_EXTRA.test(c);
}

/** `str.isdecimal()` da string inteira. */
export function todoDecimal(texto: string): boolean {
  if (!texto) return false;
  for (const c of texto) if (!RE_ND.test(c)) return false;
  return true;
}

/** `str.isalnum()` de 1 caractere. */
export function ehAlnum(c: string): boolean {
  return RE_ALNUM.test(c);
}

/** Valor de um dígito decimal Unicode (os Nd vêm em blocos contíguos de 0 a 9). */
function valorDoDigito(c: string): number {
  const cp = c.codePointAt(0)!;
  if (cp >= 48 && cp <= 57) return cp - 48;
  let inicio = cp;
  while (inicio > 0 && RE_ND.test(String.fromCodePoint(inicio - 1))) inicio--;
  return (cp - inicio) % 10;
}

/** Dígitos Unicode trocados pelos ASCII (como `int()`/`Decimal()` os leem). */
export function digitosAscii(texto: string): string {
  if (/^[\x00-\x7f]*$/.test(texto)) return texto;
  let saida = '';
  for (const c of texto) saida += RE_ND.test(c) ? String(valorDoDigito(c)) : c;
  return saida;
}

/** `int(texto)` de uma string só de dígitos. */
export function inteiro(texto: string): number {
  return parseInt(digitosAscii(texto), 10);
}

/** `round(x, 2)` do Python (empate exato vai pro par; o resto, pelo valor binário exato). */
export function round2(x: number): number {
  if (Number.isInteger(x * 8) && !Number.isInteger(x * 4)) {
    const piso = Math.floor(x * 100);
    return (piso % 2 === 0 ? piso : piso + 1) / 100;
  }
  return Number(x.toFixed(2));
}

/** `bisect.bisect_right` em lista ordenada de números. */
export function bisectRight(lista: number[], x: number): number {
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (x < lista[meio]) hi = meio;
    else lo = meio + 1;
  }
  return lo;
}

/** `bisect.bisect_left` em lista ordenada de números. */
export function bisectLeft(lista: number[], x: number): number {
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (lista[meio] < x) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

/** `collections.Counter` com a ordem de inserção (o `most_common` desempata por ela). */
export class Contador<K> {
  readonly contagem = new Map<K, number>();

  constructor(itens?: Iterable<K>) {
    if (itens) for (const k of itens) this.add(k);
  }

  add(k: K, n = 1): void {
    this.contagem.set(k, (this.contagem.get(k) ?? 0) + n);
  }

  get(k: K): number {
    return this.contagem.get(k) ?? 0;
  }

  total(): number {
    let t = 0;
    for (const n of this.contagem.values()) t += n;
    return t;
  }

  get size(): number {
    return this.contagem.size;
  }

  /** `most_common(1)[0]`: o maior; no empate, o primeiro inserido. */
  maisComum(): [K, number] | null {
    let melhor: [K, number] | null = null;
    for (const [k, n] of this.contagem) if (melhor === null || n > melhor[1]) melhor = [k, n];
    return melhor;
  }

  paraObjeto(): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const [k, n] of this.contagem) obj[String(k)] = n;
    return obj;
  }
}

/** Ordenação estável por chave (o `sorted(key=...)` do Python). */
export function ordenar<T>(lista: T[], chave: (x: T) => (number | string | boolean)[], reverso = false): T[] {
  const sinal = reverso ? -1 : 1;
  return lista
    .map((x, i) => ({ x, i, k: chave(x) }))
    .sort((a, b) => {
      const c = compararTuplas(a.k, b.k);
      return c !== 0 ? sinal * c : a.i - b.i;
    })
    .map((e) => e.x);
}

/** Comparação de tuplas como o Python (elemento a elemento; a mais curta primeiro). */
export function compararTuplas(a: (number | string | boolean)[], b: (number | string | boolean)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = typeof a[i] === 'boolean' ? Number(a[i]) : a[i];
    const y = typeof b[i] === 'boolean' ? Number(b[i]) : b[i];
    if (typeof x === 'string' && typeof y === 'string') {
      const c = compararStr(x, y);
      if (c !== 0) return c;
      continue;
    }
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

/** Comparação de strings por code point (a ordem de `str` no Python). */
export function compararStr(a: string, b: string): number {
  if (a === b) return 0;
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** Hash estável de texto (32 bits, FNV-1a): o `hash(str)` do Python muda a cada processo. */
export function hashTexto(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}
