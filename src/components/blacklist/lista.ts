/** Lista colada do Excel na BlackList (interpretarLista do BlackList.jsx). Sem dependências do Node. */

export const LIMITE_LOTE = 500;

/** Uma entidade por linha: nome e documento separados por tab ou ";" (ou o último " - "/espaço antes do documento). */
export function interpretarLista(texto: string): { nome: string; documento: string }[] {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((linha) => {
    const partes = linha.split(/\t|;/).map((p) => p.trim()).filter(Boolean);
    if (partes.length >= 2) return { nome: partes.slice(0, -1).join(' '), documento: partes[partes.length - 1] };
    const m = /^(.*?)[\s-]+([\d./-]{11,18})$/.exec(linha);
    return m ? { nome: m[1].trim(), documento: m[2] } : { nome: linha, documento: '' };
  }).filter((i) => !/^doc(umento)?$/i.test(i.documento) && !/^doc(umento)?$/i.test(i.nome));
}
