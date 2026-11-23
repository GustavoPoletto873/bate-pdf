import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { lerArquivo } from '@/lib/arquivos';

/**
 * PDFium (WebAssembly) no servidor, para as coordenadas de texto: onde, na
 * página, estão os caracteres [início, fim) do texto extraído. É o que o Bate
 * Lastro faz com get_charbox() no visualizador e no recorte (pdf_viewer.py,
 * utils/pdf_recorte.py). O índice do caractere é a posição no texto do
 * FPDFText_GetText — a mesma do texto normalizado gravado no banco (a
 * normalização preserva o comprimento), então evidências do motor e
 * ocorrências da busca caem no lugar certo.
 *
 * Coordenadas devolvidas normalizadas (0..1, origem no canto superior
 * esquerdo): o navegador posiciona em porcentagem, sem depender de zoom.
 */

export type Caixa = { x0: number; y0: number; x1: number; y1: number };

type Doc = { ptr: number; doc: number; ultimoUso: number };
type Estado = { pdfium: WrappedPdfiumModule; docs: Map<string, Doc> };
type Global = typeof globalThis & { __batePdfPdfium?: Promise<Estado> };

const MAX_DOCS_ABERTOS = 6;

/**
 * Caminho do pdfium.wasm. Resolve o pacote (externo ao bundle) e junta o nome
 * do .wasm em tempo de execução: um `require.resolve('…/pdfium.wasm')` literal
 * faz o Turbopack tentar empacotar o WebAssembly e a rota não compila.
 */
function caminhoDoWasm(): string {
  const require = createRequire(join(process.cwd(), 'package.json'));
  return join(dirname(require.resolve('@embedpdf/pdfium')), 'pdfium.wasm');
}

function estado(): Promise<Estado> {
  const g = globalThis as Global;
  g.__batePdfPdfium ??= (async () => {
    const wasm = readFileSync(caminhoDoWasm());
    const pdfium = await init({ wasmBinary: wasm });
    pdfium.PDFiumExt_Init();
    return { pdfium, docs: new Map() };
  })();
  return g.__batePdfPdfium;
}

/** O PDFium deste processo (o mesmo das caixas), para a indexação na nuvem. */
export async function pdfiumDoServidor(): Promise<WrappedPdfiumModule> {
  return (await estado()).pdfium;
}

function heapU8(pdfium: WrappedPdfiumModule): Uint8Array {
  return (pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

async function abrir(e: Estado, chave: string): Promise<number> {
  const aberto = e.docs.get(chave);
  if (aberto) {
    aberto.ultimoUso = Date.now();
    return aberto.doc;
  }
  if (e.docs.size >= MAX_DOCS_ABERTOS) {
    const [maisAntigo] = [...e.docs.entries()].sort((a, b) => a[1].ultimoUso - b[1].ultimoUso)[0];
    fechar(e, maisAntigo);
  }
  const bytes = await lerArquivo(chave);
  if (!bytes) throw new Error('O arquivo do PDF não está mais no armazenamento.');
  // Outra chamada pode ter aberto o mesmo PDF enquanto este lia.
  const ja = e.docs.get(chave);
  if (ja) return ja.doc;
  const ptr = e.pdfium.pdfium.wasmExports.malloc(bytes.length);
  heapU8(e.pdfium).set(bytes, ptr);
  const doc = e.pdfium.FPDF_LoadMemDocument(ptr, bytes.length, '');
  if (!doc) {
    e.pdfium.pdfium.wasmExports.free(ptr);
    throw new Error('Não foi possível abrir o PDF.');
  }
  e.docs.set(chave, { ptr, doc, ultimoUso: Date.now() });
  return doc;
}

function fechar(e: Estado, caminho: string) {
  const d = e.docs.get(caminho);
  if (!d) return;
  e.pdfium.FPDF_CloseDocument(d.doc);
  e.pdfium.pdfium.wasmExports.free(d.ptr);
  e.docs.delete(caminho);
}

/** Junta caixas de caracteres vizinhos na mesma linha num retângulo só. */
function juntarPorLinha(caixas: Caixa[]): Caixa[] {
  const saida: Caixa[] = [];
  for (const c of caixas) {
    const ultima = saida[saida.length - 1];
    const mesmaLinha = ultima && Math.abs((ultima.y0 + ultima.y1) / 2 - (c.y0 + c.y1) / 2) < (c.y1 - c.y0) * 0.6;
    if (ultima && mesmaLinha && c.x0 >= ultima.x0 - 0.002 && c.x0 - ultima.x1 < 0.03) {
      ultima.x1 = Math.max(ultima.x1, c.x1);
      ultima.y0 = Math.min(ultima.y0, c.y0);
      ultima.y1 = Math.max(ultima.y1, c.y1);
    } else {
      saida.push({ ...c });
    }
  }
  return saida;
}

/**
 * Caixas (normalizadas) de cada faixa [início, fim) de caracteres da página
 * (`pagina` começa em 1). `chave` é a do armazenamento (chaveDoPdf). Faixa sem caractere visível volta vazia.
 */
export async function caixasDasFaixas(chave: string, pagina: number, faixas: [number, number][]):
  Promise<{ largura: number; altura: number; caixas: Caixa[][] }> {
  const e = await estado();
  const doc = await abrir(e, chave);
  const p = e.pdfium;
  const page = p.FPDF_LoadPage(doc, pagina - 1);
  if (!page) throw new Error(`Página ${pagina} não existe no PDF.`);
  const tp = p.FPDFText_LoadPage(page);
  const largura = p.FPDF_GetPageWidthF(page);
  const altura = p.FPDF_GetPageHeightF(page);
  // 4 doubles (left, right, bottom, top).
  const buf = p.pdfium.wasmExports.malloc(32);
  try {
    const total = tp ? p.FPDFText_CountChars(tp) : 0;
    const view = () => new Float64Array(heapU8(p).buffer, buf, 4);
    const caixas = faixas.map(([ini, fim]) => {
      const chars: Caixa[] = [];
      for (let i = Math.max(0, ini); i < Math.min(fim, total); i++) {
        if (!p.FPDFText_GetCharBox(tp, i, buf, buf + 8, buf + 16, buf + 24)) continue;
        const [left, right, bottom, top] = view();
        if (right <= left || top <= bottom) continue;
        chars.push({ x0: left / largura, x1: right / largura, y0: 1 - top / altura, y1: 1 - bottom / altura });
      }
      return juntarPorLinha(chars);
    });
    return { largura, altura, caixas };
  } finally {
    p.pdfium.wasmExports.free(buf);
    if (tp) p.FPDFText_ClosePage(tp);
    p.FPDF_ClosePage(page);
  }
}
