/**
 * Indexador de texto dos PDFs de uma base — roda como processo à parte
 * (`node scripts/indexador.ts <arquivo-do-banco> <pasta-de-pdfs> <base_id>`),
 * disparado pelo servidor quando chegam PDFs novos.
 *
 * Mesma extração do Bate Lastro (modules/indexacao_pdf_texto.py): PDFium,
 * FPDFText_GetText da página inteira (o get_text_range do pypdfium2), sem OCR,
 * página sem texto descartada (numeração esparsa, começando em 1), teto de 800
 * páginas por documento. Usa o PDFium compilado para WebAssembly, então o texto
 * sai idêntico ao que o motor de pré-classificação foi calibrado.
 *
 * Processa os PDFs com status 'pendente' até não sobrar nenhum e termina.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { init } from '@embedpdf/pdfium';
import { normalizarTexto } from '../src/lib/texto.ts';

const MAX_PAGINAS = Number(process.env.INDEXACAO_PDF_MAX_PAGINAS || 800);

const [arquivoBanco, pastaPdfs, baseId] = process.argv.slice(2);
if (!arquivoBanco || !pastaPdfs || !baseId) {
  console.error('uso: node scripts/indexador.ts <banco> <pasta-pdfs> <base_id>');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
const pdfium = await init({ wasmBinary: wasm });
pdfium.PDFiumExt_Init();
const heap = pdfium.pdfium;

const banco = new DatabaseSync(arquivoBanco);
banco.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 15000;');

const proximo = banco.prepare(
  "SELECT id, sha256, nome_arquivo FROM pdfs WHERE base_id = ? AND status = 'pendente' ORDER BY id LIMIT 1",
);
const marcar = banco.prepare("UPDATE pdfs SET status = ?, erro = ?, total_paginas = ?, paginas_com_texto = ?, indexado_em = ? WHERE id = ?");
const apagarPaginas = banco.prepare('DELETE FROM paginas WHERE pdf_id = ?');
const inserirPagina = banco.prepare('INSERT INTO paginas (pdf_id, numero, texto, texto_normalizado) VALUES (?, ?, ?, ?)');

const ERROS: Record<number, string> = {
  1: 'erro desconhecido do PDFium',
  2: 'arquivo não encontrado ou ilegível',
  3: 'arquivo não é um PDF válido ou está corrompido',
  4: 'PDF protegido por senha',
  5: 'PDF com restrição de segurança não suportada',
  6: 'página com erro',
};

function extrair(bytes: Uint8Array): { paginas: { numero: number; texto: string }[]; total: number; aviso?: string } {
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
    for (let i = 0; i < Math.min(total, MAX_PAGINAS); i++) {
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
      aviso: total > MAX_PAGINAS ? `documento com ${total} páginas: indexadas só as ${MAX_PAGINAS} primeiras` : undefined,
    };
  } finally {
    pdfium.FPDF_CloseDocument(doc);
    heap.wasmExports.free(ptr);
  }
}

let processados = 0;
for (;;) {
  const pdf = proximo.get(baseId) as { id: number; sha256: string; nome_arquivo: string } | undefined;
  if (!pdf) break;
  banco.prepare("UPDATE pdfs SET status = 'indexando' WHERE id = ?").run(pdf.id);
  const caminho = join(pastaPdfs, `${pdf.sha256}.pdf`);
  const agora = () => new Date().toISOString();
  try {
    if (!existsSync(caminho)) throw new Error('arquivo do PDF não está mais na pasta de dados');
    const { paginas, total, aviso } = extrair(new Uint8Array(readFileSync(caminho)));
    banco.exec('BEGIN IMMEDIATE');
    try {
      apagarPaginas.run(pdf.id);
      for (const p of paginas) inserirPagina.run(pdf.id, p.numero, p.texto, normalizarTexto(p.texto));
      marcar.run(paginas.length ? 'indexado' : 'sem_texto', aviso ?? null, total, paginas.length, agora(), pdf.id);
      banco.exec('COMMIT');
    } catch (e) {
      banco.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    marcar.run('falhou', e instanceof Error ? e.message : String(e), null, 0, agora(), pdf.id);
  }
  processados++;
}
banco.close();
console.log(JSON.stringify({ base: baseId, processados }));
