/**
 * Coluna de vencimento da amostra (backend/modules/base_direito_creditorio.py:
 * colunas_de_vencimento e completar_vencimento), sobre linhas já lidas da
 * planilha em vez de um DataFrame.
 *
 * Vale a coluna escolhida no upload; numa linha em que ela está vazia, vale a
 * outra coluna de vencimento do arquivo (a ajustada, se a escolhida é a
 * original, e vice-versa).
 */
import { split } from './py';

export const CAMPO_VENCIMENTO = 'DATA_VENCIMENTO_ORIGINAL';
const CONECTORES = new Set(['de', 'do', 'da', 'dos', 'das']);

/** Minúsculo, sem acento, sem pontuação e sem conectores — só as palavras grudadas. */
export function normalizarNomeColuna(texto: unknown): string {
  const semAcento = String(texto).normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
  return semAcento.toLowerCase().split(/[^a-z0-9]+/).filter((p) => p && !CONECTORES.has(p)).join('');
}

/** Colunas de DATA de vencimento (original/ajustada) do arquivo; coluna de valor fica de fora. */
export function colunasDeVencimento(colunas: string[]): string[] {
  return colunas.filter((c) => {
    const n = normalizarNomeColuna(c);
    return n.includes('vencimento') && (n.includes('original') || n.includes('ajustad')) && !n.includes('valor');
  });
}

export type OrigemVencimento = { escolhida: string | null; linhas: Record<number, string> };

function textoDaCelula(v: unknown): string {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '';
  return split(String(v)).length ? String(v).trim() : '';
}

/**
 * Preenche o vencimento escolhido com a outra coluna nas linhas vazias.
 * Devolve as linhas (cópias), o mapeamento (com a coluna que assumiu, se
 * nada estava mapeado) e a origem: a coluna escolhida e, por posição da
 * linha, a coluna usada no lugar.
 */
export function completarVencimento(
  linhas: Record<string, unknown>[], colunas: string[], mapeamento: Record<string, string> | null = null,
): { linhas: Record<string, unknown>[]; colunas: string[]; mapeamento: Record<string, string> | null; origem: OrigemVencimento } {
  const origem: OrigemVencimento = { escolhida: null, linhas: {} };
  let mapa = mapeamento;
  let escolhida: string | null;
  if (mapa && Object.keys(mapa).length) {
    escolhida = Object.entries(mapa).find(([, v]) => v === CAMPO_VENCIMENTO)?.[0] ?? null;
  } else {
    escolhida = colunas.includes(CAMPO_VENCIMENTO) ? CAMPO_VENCIMENTO : null;
  }
  const alternativas = colunasDeVencimento(colunas).filter((c) => c !== escolhida);
  if (escolhida === null) {
    if (!alternativas.length) return { linhas, colunas, mapeamento: mapa, origem };
    escolhida = alternativas.shift()!;
    if (mapa !== null) mapa = { ...mapa, [escolhida]: CAMPO_VENCIMENTO };
  }
  if (!colunas.includes(escolhida)) return { linhas, colunas, mapeamento: mapa, origem };
  origem.escolhida = escolhida;
  let saida = linhas.map((l) => ({ ...l }));
  for (const alternativa of alternativas) {
    saida.forEach((l, posicao) => {
      if (textoDaCelula(l[escolhida!]) === '' && textoDaCelula(l[alternativa]) !== '') {
        origem.linhas[posicao] = alternativa;
        l[escolhida!] = l[alternativa];
      }
    });
  }
  let cols = colunas;
  if (mapa === null && escolhida !== CAMPO_VENCIMENTO) {
    saida = saida.map((l) => {
      const novo: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(l)) novo[k === escolhida ? CAMPO_VENCIMENTO : k] = v;
      return novo;
    });
    cols = colunas.map((c) => (c === escolhida ? CAMPO_VENCIMENTO : c));
  }
  return { linhas: saida, colunas: cols, mapeamento: mapa, origem };
}
