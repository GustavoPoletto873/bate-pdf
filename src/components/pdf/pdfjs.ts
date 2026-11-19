'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * pdf.js carregado sob demanda (só no navegador: o módulo usa DOMMatrix e
 * quebraria na renderização do servidor). O worker é servido de /public,
 * copiado do pacote — sem CDN.
 */

type PdfJs = typeof import('pdfjs-dist');
let modulo: Promise<PdfJs> | null = null;

export function carregarPdfjs(): Promise<PdfJs> {
  modulo ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    return m;
  });
  return modulo;
}

const MAX_DOCS = 6;
const docs = new Map<number, Promise<PDFDocumentProxy>>();

/** Documento aberto (cache dos últimos abertos: o conteúdo de um pdf_id nunca muda). */
export function abrirDocumento(pdfId: number): Promise<PDFDocumentProxy> {
  const existente = docs.get(pdfId);
  if (existente) {
    docs.delete(pdfId);
    docs.set(pdfId, existente);
    return existente;
  }
  const p = carregarPdfjs().then((m) => m.getDocument({ url: `/api/pdfs/${pdfId}/arquivo` }).promise);
  p.catch(() => docs.delete(pdfId));
  docs.set(pdfId, p);
  while (docs.size > MAX_DOCS) {
    const [antigo, promessa] = docs.entries().next().value!;
    docs.delete(antigo);
    promessa.then((d) => d.destroy()).catch(() => {});
  }
  return p;
}

export type CaixaNormalizada = { x0: number; y0: number; x1: number; y1: number; tipo?: string };
