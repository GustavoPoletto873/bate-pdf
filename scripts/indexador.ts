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
 *
 * Banco: o mesmo do servidor (libSQL). Com LASTRO_DB_URL / TURSO_DATABASE_URL no ambiente usa o
 * Turso; senão o arquivo passado no argumento. As páginas de cada PDF vão num lote só (no Turso
 * cada consulta é uma ida à rede); os gatilhos do esquema mantêm a paginas_fts.
 * (Importa @libsql/client direto: o node roda este .ts sem o alias @/ nem resolução sem extensão.)
 */
import { createClient, type InStatement } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { init } from '@embedpdf/pdfium';
import { normalizarTexto } from '../src/lib/texto.ts';
import { comandosDasPaginas, extrairTexto, MARCAR_PDF, MAX_PAGINAS_PADRAO } from '../src/lib/pdf/extracao.ts';

const MAX_PAGINAS = Number(process.env.INDEXACAO_PDF_MAX_PAGINAS || MAX_PAGINAS_PADRAO);

const [arquivoBanco, pastaPdfs, baseId] = process.argv.slice(2);
if (!arquivoBanco || !pastaPdfs || !baseId) {
  console.error('uso: node scripts/indexador.ts <banco> <pasta-pdfs> <base_id>');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
const pdfium = await init({ wasmBinary: wasm });
pdfium.PDFiumExt_Init();

const remota = process.env.LASTRO_DB_URL?.trim() || process.env.TURSO_DATABASE_URL?.trim();
const local = !remota || remota.startsWith('file:');
const banco = createClient(remota
  ? { url: remota, authToken: (process.env.LASTRO_DB_TOKEN || process.env.TURSO_AUTH_TOKEN)?.trim() }
  : { url: 'file:' + arquivoBanco.replace(/\\/g, '/') });
if (local) await banco.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 15000;');
await banco.execute('PRAGMA foreign_keys = ON');

let processados = 0;
for (;;) {
  const linha = (await banco.execute({
    sql: "SELECT id, sha256, nome_arquivo FROM pdfs WHERE base_id = ? AND status = 'pendente' ORDER BY id LIMIT 1",
    args: [baseId],
  })).rows[0];
  if (!linha) break;
  const pdf = { id: Number(linha.id), sha256: String(linha.sha256) };
  await banco.execute({ sql: "UPDATE pdfs SET status = 'indexando' WHERE id = ?", args: [pdf.id] });
  const caminho = join(pastaPdfs, `${pdf.sha256}.pdf`);
  const agora = () => new Date().toISOString();
  try {
    if (!existsSync(caminho)) throw new Error('arquivo do PDF não está mais na pasta de dados');
    // Apagar, gravar as páginas e marcar: um lote só, atômico.
    await banco.batch(comandosDasPaginas(pdf.id, extrairTexto(pdfium, new Uint8Array(readFileSync(caminho)), MAX_PAGINAS), normalizarTexto, agora()) as InStatement[], 'write');
  } catch (e) {
    await banco.execute({ sql: MARCAR_PDF, args: ['falhou', e instanceof Error ? e.message : String(e), null, 0, agora(), pdf.id] });
  }
  processados++;
}
banco.close();
console.log(JSON.stringify({ base: baseId, processados }));
