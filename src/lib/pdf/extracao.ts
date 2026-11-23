import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

/**
 * Extração do texto das páginas, igual à do Bate Lastro (modules/indexacao_pdf_texto.py):
 * FPDFText_GetText da página inteira, sem OCR, página sem texto descartada (numeração esparsa,
 * começando em 1), teto de páginas por documento.
 *
 * Usado pelo indexador local (scripts/indexador.ts, processo à parte) e pelo da nuvem
 * (lib/indexacao.ts). Sem imports com o alias @/: o node roda o script direto.
 */

const ERROS: Record<number, string> = {
  1: 'erro desconhecido do PDFium',
  2: 'arquivo não encontrado ou ilegível',
  3: 'arquivo não é um PDF válido ou está corrompido',
  4: 'PDF protegido por senha',
  5: 'PDF com restrição de segurança não suportada',
  6: 'página com erro',
};

export const MAX_PAGINAS_PADRAO = 800;

export function extrairTexto(pdfium: WrappedPdfiumModule, bytes: Uint8Array, maxPaginas = MAX_PAGINAS_PADRAO):
  { paginas: { numero: number; texto: string }[]; total: number; aviso?: string } {
  const heap = pdfium.pdfium;
  const ptr = heap.wasmExports.malloc(bytes.length);
  // HEAPU8 existe em tempo de execução (Emscripten), mas não está nas tipagens do pacote.
  // Lido depois do malloc: a memória pode ter crescido e trocado o buffer.
  (heap as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, ptr);
  const doc = pdfium.FPDF_LoadMemDocument(ptr, bytes.length, '');
  if (!doc) {
    const codigo = pdfium.FPDF_GetLastError();
    heap.wasmExports.free(ptr);
    throw new Error(ERROS[codigo] ?? `erro ${codigo} ao abrir o PDF`);
  }
  try {
    const total = pdfium.FPDF_GetPageCount(doc);
    const paginas: { numero: number; texto: string }[] = [];
    for (let i = 0; i < Math.min(total, maxPaginas); i++) {
      const pagina = pdfium.FPDF_LoadPage(doc, i);
      if (!pagina) continue;
      const tp = pdfium.FPDFText_LoadPage(pagina);
      try {
        const n = tp ? pdfium.FPDFText_CountChars(tp) : 0;
        if (n > 0) {
          const buf = heap.wasmExports.malloc((n + 1) * 2);
          pdfium.FPDFText_GetText(tp, 0, n, buf);
          const texto = heap.UTF16ToString(buf);
          heap.wasmExports.free(buf);
          if (texto.trim()) paginas.push({ numero: i + 1, texto });
        }
      } finally {
        if (tp) pdfium.FPDFText_ClosePage(tp);
        pdfium.FPDF_ClosePage(pagina);
      }
    }
    return {
      paginas,
      total,
      aviso: total > maxPaginas ? `documento com ${total} páginas: indexadas só as ${maxPaginas} primeiras` : undefined,
    };
  } finally {
    pdfium.FPDF_CloseDocument(doc);
    heap.wasmExports.free(ptr);
  }
}

/** Páginas por INSERT (4 valores cada; longe do limite de parâmetros). */
const POR_INSERT = 100;

export const MARCAR_PDF = 'UPDATE pdfs SET status = ?, erro = ?, total_paginas = ?, paginas_com_texto = ?, indexado_em = ? WHERE id = ?';

/** Os comandos que gravam as páginas de um PDF e marcam o status (um lote atômico). */
export function comandosDasPaginas(pdfId: number, extraido: ReturnType<typeof extrairTexto>, normalizar: (t: string) => string, agora: string):
  { sql: string; args: (string | number | null)[] }[] {
  const { paginas, total, aviso } = extraido;
  const comandos: { sql: string; args: (string | number | null)[] }[] = [{ sql: 'DELETE FROM paginas WHERE pdf_id = ?', args: [pdfId] }];
  for (let i = 0; i < paginas.length; i += POR_INSERT) {
    const bloco = paginas.slice(i, i + POR_INSERT);
    comandos.push({
      sql: `INSERT INTO paginas (pdf_id, numero, texto, texto_normalizado) VALUES ${bloco.map(() => '(?, ?, ?, ?)').join(', ')}`,
      args: bloco.flatMap((p) => [pdfId, p.numero, p.texto, normalizar(p.texto)]),
    });
  }
  comandos.push({ sql: MARCAR_PDF, args: [paginas.length ? 'indexado' : 'sem_texto', aviso ?? null, total, paginas.length, agora, pdfId] });
  return comandos;
}
