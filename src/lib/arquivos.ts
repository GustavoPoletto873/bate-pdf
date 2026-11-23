import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pastaDeDados } from '@/lib/db';

/**
 * Arquivos do app (PDFs, XMLs, relatórios, amostras) por **chave** relativa, ex.:
 * `pdfs/<baseId>/<sha256>.pdf`. O mesmo código roda nos dois modos:
 *
 * - **Local** (padrão): a chave é um caminho dentro da pasta de dados (BATE_PDF_DADOS ou ./data).
 * - **Nuvem**: Vercel Blob privado, quando BLOB_READ_WRITE_TOKEN está definido. Os arquivos
 *   nunca ficam públicos: só o servidor (com o token) lê.
 */

export function armazenamentoNaNuvem(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/** Chave do PDF de uma base. */
export const chaveDoPdf = (baseId: string, sha256: string) => `pdfs/${baseId}/${sha256}.pdf`;

const limpa = (chave: string) => {
  const c = chave.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!c || c.split('/').some((p) => p === '..' || p === '')) throw new Error(`Chave de arquivo inválida: ${chave}`);
  return c;
};

const caminhoLocal = (chave: string) => join(/*turbopackIgnore: true*/ pastaDeDados(), ...limpa(chave).split('/'));

const blob = () => import('@vercel/blob');

export async function gravarArquivo(chave: string, bytes: Uint8Array, tipo?: string): Promise<void> {
  if (armazenamentoNaNuvem()) {
    const { put } = await blob();
    await put(limpa(chave), Buffer.from(bytes), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: tipo });
    return;
  }
  const destino = caminhoLocal(chave);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, bytes);
}

/** O conteúdo do arquivo, ou null se não existir. */
export async function lerArquivo(chave: string): Promise<Uint8Array | null> {
  if (armazenamentoNaNuvem()) {
    const { get } = await blob();
    const r = await get(limpa(chave), { access: 'private' });
    if (!r?.stream) return null;
    return new Uint8Array(await new Response(r.stream).arrayBuffer());
  }
  try {
    return new Uint8Array(await readFile(caminhoLocal(chave)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function existeArquivo(chave: string): Promise<boolean> {
  if (armazenamentoNaNuvem()) {
    const { head, BlobNotFoundError } = await blob();
    try {
      await head(limpa(chave));
      return true;
    } catch (e) {
      if (e instanceof BlobNotFoundError) return false;
      throw e;
    }
  }
  return stat(caminhoLocal(chave)).then(() => true, () => false);
}

/** Apaga tudo o que começa com o prefixo (ex.: `pdfs/<baseId>/`). */
export async function apagarPasta(prefixo: string): Promise<void> {
  const p = limpa(prefixo.replace(/\/+$/, '')) + '/';
  if (armazenamentoNaNuvem()) {
    const { list, del } = await blob();
    let cursor: string | undefined;
    do {
      const r = await list({ prefix: p, cursor, limit: 1000 });
      if (r.blobs.length) await del(r.blobs.map((b) => b.url));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return;
  }
  await rm(caminhoLocal(p.slice(0, -1)), { recursive: true, force: true });
}

export async function apagarArquivo(chave: string): Promise<void> {
  if (armazenamentoNaNuvem()) {
    const { del } = await blob();
    await del(limpa(chave));
    return;
  }
  await rm(caminhoLocal(chave), { force: true });
}
