import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';

/**
 * Número de páginas do PDF antes de mandar para o Gemini (MAX_PAGINAS_IA = 50 no Bate Lastro).
 * Usa o mesmo PDFium (WebAssembly) do indexador, numa instância própria; PDF que o PDFium
 * não abre (corrompido, com senha) é recusado antes de gastar com a IA.
 */

export class PdfIlegivel extends Error {}

type Global = typeof globalThis & { __batePdfPdfiumPaginas?: Promise<WrappedPdfiumModule> };

function pdfium(): Promise<WrappedPdfiumModule> {
  const g = globalThis as Global;
  g.__batePdfPdfiumPaginas ??= (async () => {
    const require = createRequire(join(process.cwd(), 'package.json'));
    const wasm = readFileSync(join(dirname(require.resolve('@embedpdf/pdfium')), 'pdfium.wasm'));
    const m = await init({ wasmBinary: wasm });
    m.PDFiumExt_Init();
    return m;
  })();
  return g.__batePdfPdfiumPaginas;
}

const ERROS: Record<number, string> = {
  2: 'arquivo ilegível',
  3: 'o arquivo não é um PDF válido ou está corrompido',
  4: 'o PDF está protegido por senha',
  5: 'o PDF tem uma restrição de segurança não suportada',
};

export async function contarPaginas(bytes: Uint8Array): Promise<number> {
  const m = await pdfium();
  const heap = m.pdfium;
  const ptr = heap.wasmExports.malloc(bytes.length);
  (heap as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, ptr);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, '');
  if (!doc) {
    const codigo = m.FPDF_GetLastError();
    heap.wasmExports.free(ptr);
    throw new PdfIlegivel(`Não foi possível abrir o PDF: ${ERROS[codigo] ?? 'arquivo corrompido'}.`);
  }
  try {
    return m.FPDF_GetPageCount(doc);
  } finally {
    m.FPDF_CloseDocument(doc);
    heap.wasmExports.free(ptr);
  }
}
