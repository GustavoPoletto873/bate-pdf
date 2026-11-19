/**
 * Data de referência da base — porta de backend/utils/date_utils.py e de
 * frontend/src/utils/quarterUtils.js do Bate Lastro. Sem dependências: vale no servidor e no
 * navegador. Datas circulam como ISO "AAAA-MM-DD".
 *
 * - TRIMESTRE: a data vale pelo trimestre (gravada como o último dia do trimestre; buscas cobrem
 *   o trimestre inteiro).
 * - DATA_REFERENCIA: a data vale exatamente como informada.
 */

export type ModoReferencia = 'TRIMESTRE' | 'DATA_REFERENCIA';
export const MODOS_REFERENCIA: ModoReferencia[] = ['TRIMESTRE', 'DATA_REFERENCIA'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "AAAA-MM-DD" que existe no calendário. */
export function dataIsoValida(iso: string | null | undefined): iso is string {
  const m = ISO.exec(iso ?? '');
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Último dia do trimestre 1–4 de um ano: (3, 2026) → "2026-09-30". */
export function fimDoTrimestre(trimestre: number, ano: number): string {
  const mes = trimestre * 3;
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

/** Primeiro dia do trimestre 1–4 de um ano. */
export function inicioDoTrimestre(trimestre: number, ano: number): string {
  return `${ano}-${doisDigitos((trimestre - 1) * 3 + 1)}-01`;
}

/** Trimestre (1–4) e ano de uma data ISO. */
export function trimestreDe(iso: string): { trimestre: number; ano: number } {
  const [ano, mes] = iso.split('-').map(Number);
  return { trimestre: Math.floor((mes - 1) / 3) + 1, ano };
}

/** ultimo_dia_trimestre: 2026-08-15 → 2026-09-30. */
export function ultimoDiaDoTrimestre(iso: string): string {
  const { trimestre, ano } = trimestreDe(iso);
  return fimDoTrimestre(trimestre, ano);
}

/** intervalo_trimestre: (início, fim) do trimestre da data. */
export function intervaloTrimestre(iso: string): [string, string] {
  const { trimestre, ano } = trimestreDe(iso);
  return [inicioDoTrimestre(trimestre, ano), fimDoTrimestre(trimestre, ano)];
}

/** normalizar_data_referencia: a data que vai gravada na base. */
export function normalizarDataReferencia(iso: string, modo: ModoReferencia): string {
  return modo === 'DATA_REFERENCIA' ? iso : ultimoDiaDoTrimestre(iso);
}

/** intervalo_referencia: trimestre inteiro ou só o próprio dia. */
export function intervaloReferencia(iso: string, modo: ModoReferencia): [string, string] {
  return modo === 'DATA_REFERENCIA' ? [iso, iso] : intervaloTrimestre(iso);
}

/** validar_modo_referencia; ausente = DATA_REFERENCIA (na versão local não há padrão da instituição). */
export function lerModoReferencia(valor: unknown): ModoReferencia | null {
  if (valor === null || valor === undefined || valor === '') return 'DATA_REFERENCIA';
  const m = String(valor).trim().toUpperCase();
  return (MODOS_REFERENCIA as string[]).includes(m) ? (m as ModoReferencia) : null;
}

/** "30/09/2026". */
export function dataBr(iso: string | null | undefined): string {
  const m = ISO.exec(String(iso ?? '').slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? '');
}

/** formatDataReferencia: '3º Trim/2026' (TRIMESTRE) ou '30/09/2026'. */
export function rotuloReferencia(iso: string | null | undefined, modo: ModoReferencia | string | null | undefined): string {
  if (!iso) return '';
  if (modo === 'TRIMESTRE' && dataIsoValida(iso.slice(0, 10))) {
    const { trimestre, ano } = trimestreDe(iso.slice(0, 10));
    return `${trimestre}º Trim/${ano}`;
  }
  return dataBr(iso);
}
