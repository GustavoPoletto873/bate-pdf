import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, pastaDeDados, pastaDePdfs } from '@/lib/db';
import { registrarPdf, tocarBase } from '@/lib/repo';
import type { Lado } from '@/lib/campos';

/**
 * Indexação de texto em segundo plano: um processo Node por base
 * (scripts/indexador.ts), para a extração do PDFium não travar o servidor.
 */

type Global = typeof globalThis & { __batePdfIndexadores?: Map<string, ChildProcess> };

function rodando(): Map<string, ChildProcess> {
  const g = globalThis as Global;
  g.__batePdfIndexadores ??= new Map();
  return g.__batePdfIndexadores;
}

export function indexando(baseId: string): boolean {
  return rodando().has(baseId);
}

/** Dispara o indexador da base se houver PDF pendente e nenhum rodando. */
export function iniciarIndexacao(baseId: string): boolean {
  const ativos = rodando();
  if (ativos.has(baseId)) return false;
  const c = db();
  // Processo que morreu no meio deixa PDF em 'indexando': volta para a fila.
  c.prepare("UPDATE pdfs SET status = 'pendente' WHERE base_id = ? AND status = 'indexando'").run(baseId);
  const pend = c.prepare("SELECT COUNT(*) n FROM pdfs WHERE base_id = ? AND status = 'pendente'").get(baseId) as { n: number };
  if (!pend.n) return false;

  const script = join(process.cwd(), 'scripts', 'indexador.ts');
  const filho = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script,
    join(pastaDeDados(), 'bate-pdf.db'), pastaDePdfs(baseId), baseId], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  ativos.set(baseId, filho);
  let erro = '';
  filho.stderr?.on('data', (d) => { erro = (erro + String(d)).slice(-4000); });
  filho.on('exit', (codigo) => {
    ativos.delete(baseId);
    if (codigo !== 0) console.error(`[indexador ${baseId}] saiu com código ${codigo}: ${erro}`);
    tocarBase(baseId);
    // Chegou PDF enquanto rodava? Recomeça.
    const resta = db().prepare("SELECT COUNT(*) n FROM pdfs WHERE base_id = ? AND status = 'pendente'").get(baseId) as { n: number };
    if (codigo === 0 && resta.n) iniciarIndexacao(baseId);
  });
  return true;
}

export type PdfRecebido = { nome: string; caminhoRelativo: string | null; bytes: Uint8Array; tipo?: Lado | null };

const ASSINATURA_PDF = '%PDF';

/** Grava os PDFs na pasta da base (nome = sha256, então reenvio não duplica) e registra. */
export function receberPdfs(baseId: string, arquivos: PdfRecebido[]) {
  const pasta = pastaDePdfs(baseId);
  mkdirSync(pasta, { recursive: true });
  const resultado = { novos: 0, repetidos: 0, recusados: [] as { nome: string; motivo: string }[] };
  for (const a of arquivos) {
    const cabeca = new TextDecoder('latin1').decode(a.bytes.slice(0, 1024));
    if (!cabeca.includes(ASSINATURA_PDF)) {
      resultado.recusados.push({ nome: a.nome, motivo: 'não é um arquivo PDF' });
      continue;
    }
    const sha = createHash('sha256').update(a.bytes).digest('hex');
    const destino = join(pasta, `${sha}.pdf`);
    if (!existsSync(destino)) writeFileSync(destino, a.bytes);
    const r = registrarPdf(baseId, { nome_arquivo: a.nome, caminho_relativo: a.caminhoRelativo, sha256: sha, tamanho: a.bytes.length, tipo_declarado: a.tipo ?? null });
    if (r.novo) resultado.novos++;
    else resultado.repetidos++;
  }
  tocarBase(baseId);
  iniciarIndexacao(baseId);
  return resultado;
}

export type PdfGravado = { nome: string; caminhoRelativo: string | null; pdf_id: number; novo: boolean } | { nome: string; caminhoRelativo: string | null; motivo: string };

/**
 * Como receberPdfs, mas devolve o id de cada PDF gravado (o Anexo liga o documento ao PDF).
 * O PDF entra na base e na indexação de texto do Bater PDF do mesmo jeito.
 */
export function receberPdfsComIds(baseId: string, arquivos: PdfRecebido[]): PdfGravado[] {
  const pasta = pastaDePdfs(baseId);
  mkdirSync(pasta, { recursive: true });
  const resultado: PdfGravado[] = [];
  for (const a of arquivos) {
    const cabeca = new TextDecoder('latin1').decode(a.bytes.slice(0, 1024));
    if (!cabeca.includes(ASSINATURA_PDF)) {
      resultado.push({ nome: a.nome, caminhoRelativo: a.caminhoRelativo, motivo: 'não é um arquivo PDF' });
      continue;
    }
    const sha = createHash('sha256').update(a.bytes).digest('hex');
    const destino = join(pasta, `${sha}.pdf`);
    if (!existsSync(destino)) writeFileSync(destino, a.bytes);
    const r = registrarPdf(baseId, { nome_arquivo: a.nome, caminho_relativo: a.caminhoRelativo, sha256: sha, tamanho: a.bytes.length, tipo_declarado: a.tipo ?? null });
    resultado.push({ nome: a.nome, caminhoRelativo: a.caminhoRelativo, pdf_id: r.id, novo: r.novo });
  }
  if (arquivos.length) {
    tocarBase(baseId);
    iniciarIndexacao(baseId);
  }
  return resultado;
}
