/**
 * Conversão de valores da planilha (moeda e data) — mesmas regras do upload
 * do Bate Lastro (limpar_valor_monetario e limpar_e_validar_data em
 * backend/modules/base_direito_creditorio.py) e da importação do resultado
 * (_valor/_data em importar_resultado_matching_service.py).
 *
 * Moeda circula como string decimal com 2 casas ("1613.33"); data como ISO
 * "AAAA-MM-DD". Nada de float para comparar dinheiro.
 */

function pareceSeparadorDeMilhar(partes: string[]): boolean {
  const primeiro = partes[0].replace(/^[+-]/, '');
  return primeiro.length >= 1 && primeiro.length <= 3 && partes.slice(1).every((p) => p.length === 3);
}

/** Valor monetário → string decimal "1234.56", ou null quando vazio/inválido/zero. */
export function lerMoeda(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '' || typeof valor === 'boolean') return null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor === 0) return null;
    return arredondar2(valor.toString());
  }
  let texto = String(valor).trim().replace(/[R$\s"]/g, '');
  if (!texto || ['nan', 'None', 'NaN'].includes(texto)) return null;
  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');
  if (temVirgula && temPonto) {
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) texto = texto.replace(/\./g, '').replace(',', '.');
    else texto = texto.replace(/,/g, '');
  } else if (temVirgula) {
    const partes = texto.split(',');
    texto = partes.length === 2 && !pareceSeparadorDeMilhar(partes) ? texto.replace(',', '.') : texto.replace(/,/g, '');
  } else if (temPonto) {
    const partes = texto.split('.');
    if (!(partes.length === 2 && !pareceSeparadorDeMilhar(partes))) texto = texto.replace(/\./g, '');
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(texto)) return null;
  const resultado = arredondar2(texto);
  return /^-?0\.00$/.test(resultado) ? null : resultado;
}

/** "1234.5" → "1234.50" sem passar por float (arredonda meio para cima). */
function arredondar2(texto: string): string {
  let t = texto;
  if (/e/i.test(t)) t = Number(t).toFixed(10);
  const negativo = t.startsWith('-');
  t = t.replace(/^[+-]/, '');
  const [inteiro, frac = ''] = t.split('.');
  const centavos = BigInt(inteiro || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  const arred = (frac[2] ?? '0') >= '5' ? centavos + 1n : centavos;
  const s = arred.toString().padStart(3, '0');
  return `${negativo && arred !== 0n ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Centavos inteiros (para comparar). */
export function centavos(valor: string | null | undefined): bigint | null {
  if (!valor) return null;
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(valor);
  if (!m) return null;
  const v = BigInt(m[2]) * 100n + BigInt(m[3]);
  return m[1] ? -v : v;
}

const MS_DIA = 86_400_000;
// Época do Excel (série 1 = 1900-01-01, com o bug do 29/02/1900).
const EPOCA_EXCEL = Date.UTC(1899, 11, 30);

function iso(ano: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  if (ano < 1900 || ano > 2100) return null;
  return d.toISOString().slice(0, 10);
}

/** Data → "AAAA-MM-DD", com dia primeiro nas datas com barra (nunca MM/DD). */
export function lerData(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    // ExcelJS devolve a data da célula como meia-noite UTC.
    return iso(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate());
  }
  if (typeof valor === 'number') {
    if (valor < 1 || valor > 80000) return null;
    const d = new Date(EPOCA_EXCEL + Math.floor(valor) * MS_DIA);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const texto = String(valor).trim().replace(/["']/g, '');
  if (!texto) return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/.exec(texto);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T].*)?$/.exec(texto);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/.exec(texto);
  if (m) return iso(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** "2026-09-15" → "15/09/2026". */
export function formatarData(isoData: string | null | undefined): string {
  if (!isoData) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoData);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(isoData);
}

/** "1613.33" → "R$ 1.613,33". */
export function formatarMoeda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const texto = typeof valor === 'number' ? valor.toFixed(2) : valor;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(texto);
  if (!m) return String(valor);
  const inteiro = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${m[1]}R$ ${inteiro},${(m[3] ?? '').padEnd(2, '0')}`;
}

/** Valor digitado em pt-BR ("1.400,00") → "1400.00"; ponto é sempre milhar. */
export function moedaDigitada(digitado: string): string | null {
  let n = digitado.trim().replace(/[R$\s]/g, '').replace(/\./g, '');
  if (n.includes(',')) n = n.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(n)) return null;
  return arredondar2(n);
}

export function hojeIso(): string {
  return new Date().toISOString();
}
