import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { after } from 'next/server';
import { armazenamentoNaNuvem, chaveDoPdf, existeArquivo, gravarArquivo, lerArquivo } from '@/lib/arquivos';
import { db, pastaDeDados, pastaDePdfs } from '@/lib/db';
import { comandosDasPaginas, extrairTexto, MARCAR_PDF, MAX_PAGINAS_PADRAO } from '@/lib/pdf/extracao';
import { pdfiumDoServidor } from '@/lib/pdf/pdfium';
import { registrarPdf, tocarBase } from '@/lib/repo';
import { normalizarTexto } from '@/lib/texto';
import type { Lado } from '@/lib/campos';

/**
 * Indexação de texto dos PDFs em segundo plano.
 *
 * - **Local**: um processo Node por base (scripts/indexador.ts), para a extração do PDFium não
 *   travar o servidor.
 * - **Nuvem** (Vercel, sem processos contínuos): no próprio servidor, depois de responder
 *   (`after`), com tempo limitado; o que sobrar é retomado na próxima consulta aos PDFs da base.
 *   Cada PDF é reservado de forma atômica, então duas instâncias não indexam o mesmo.
 */

const MAX_PAGINAS = Number(process.env.INDEXACAO_PDF_MAX_PAGINAS || MAX_PAGINAS_PADRAO);
/** Na nuvem: quanto tempo uma rodada indexa (a função tem maxDuration maior). */
const ORCAMENTO_MS = Number(process.env.INDEXACAO_ORCAMENTO_MS || 200_000);
/** PDF "indexando" há mais que isto foi largado por uma instância que morreu: volta para a fila. */
const LARGADO_MS = 10 * 60_000;

const naNuvem = () => armazenamentoNaNuvem() || Boolean(process.env.VERCEL);

type Global = typeof globalThis & { __batePdfIndexadores?: Map<string, ChildProcess | 'local'> };

function rodando(): Map<string, ChildProcess | 'local'> {
  const g = globalThis as Global;
  g.__batePdfIndexadores ??= new Map();
  return g.__batePdfIndexadores;
}

export function indexando(baseId: string): boolean {
  return rodando().has(baseId);
}

/** Dispara o indexador da base se houver PDF pendente e nenhum rodando (nesta instância). */
export async function iniciarIndexacao(baseId: string): Promise<boolean> {
  const ativos = rodando();
  if (ativos.has(baseId)) return false;
  const c = await db();
  if (naNuvem()) {
    await c.prepare("UPDATE pdfs SET status = 'pendente' WHERE base_id = ? AND status = 'indexando' AND (indexado_em IS NULL OR indexado_em < ?)")
      .run(baseId, new Date(Date.now() - LARGADO_MS).toISOString());
  } else {
    // Processo que morreu no meio deixa PDF em 'indexando': volta para a fila.
    await c.prepare("UPDATE pdfs SET status = 'pendente' WHERE base_id = ? AND status = 'indexando'").run(baseId);
  }
  const pend = (await c.prepare("SELECT COUNT(*) n FROM pdfs WHERE base_id = ? AND status = 'pendente'").get<{ n: number }>(baseId))!;
  // Outra chamada pode ter disparado o indexador enquanto esta esperava o banco.
  if (!pend.n || ativos.has(baseId)) return false;

  if (naNuvem()) {
    ativos.set(baseId, 'local');
    const tarefa = async () => {
      try {
        await indexarAqui(baseId, Date.now() + ORCAMENTO_MS);
        await tocarBase(baseId);
      } catch (e) {
        console.error(`[indexador ${baseId}]`, e);
      } finally {
        ativos.delete(baseId);
      }
    };
    // Dentro de uma requisição: depois da resposta. Fora (fila do Anexo): já em segundo plano.
    try { after(tarefa); } catch { void tarefa(); }
    return true;
  }

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
    void (async () => {
      await tocarBase(baseId);
      // Chegou PDF enquanto rodava? Recomeça.
      const resta = (await (await db()).prepare("SELECT COUNT(*) n FROM pdfs WHERE base_id = ? AND status = 'pendente'").get<{ n: number }>(baseId))!;
      if (codigo === 0 && resta.n) await iniciarIndexacao(baseId);
    })().catch((e) => console.error(`[indexador ${baseId}]`, e));
  });
  return true;
}

/** Indexa os PDFs pendentes da base neste processo, até acabar ou até `limite` (ms epoch). */
export async function indexarAqui(baseId: string, limite = Infinity): Promise<number> {
  const c = await db();
  const pdfium = await pdfiumDoServidor();
  let n = 0;
  while (Date.now() < limite) {
    const agora = new Date().toISOString();
    // Reserva atômica: só uma instância pega cada PDF.
    const pdf = await c.prepare(`UPDATE pdfs SET status = 'indexando', indexado_em = ?
      WHERE id = (SELECT id FROM pdfs WHERE base_id = ? AND status = 'pendente' ORDER BY id LIMIT 1) AND status = 'pendente'
      RETURNING id, sha256`).get<{ id: number; sha256: string }>(agora, baseId);
    if (!pdf) break;
    try {
      const bytes = await lerArquivo(chaveDoPdf(baseId, pdf.sha256));
      if (!bytes) throw new Error('arquivo do PDF não está mais no armazenamento');
      const comandos = comandosDasPaginas(pdf.id, extrairTexto(pdfium, bytes, MAX_PAGINAS), normalizarTexto, new Date().toISOString());
      await c.lote(comandos);
    } catch (e) {
      await c.prepare(MARCAR_PDF).run('falhou', e instanceof Error ? e.message : String(e), null, 0, new Date().toISOString(), pdf.id);
    }
    n++;
  }
  return n;
}

export type PdfRecebido = { nome: string; caminhoRelativo: string | null; bytes: Uint8Array; tipo?: Lado | null };

const ASSINATURA_PDF = '%PDF';

export type PdfGravado = { nome: string; caminhoRelativo: string | null; pdf_id: number; novo: boolean } | { nome: string; caminhoRelativo: string | null; motivo: string };

/**
 * Grava os PDFs no armazenamento da base (nome = sha256, então reenvio não duplica), registra e
 * dispara a indexação. Devolve o id de cada PDF gravado (o Anexo liga o documento ao PDF).
 */
export async function receberPdfsComIds(baseId: string, arquivos: PdfRecebido[]): Promise<PdfGravado[]> {
  const resultado: PdfGravado[] = [];
  for (const a of arquivos) {
    const cabeca = new TextDecoder('latin1').decode(a.bytes.slice(0, 1024));
    if (!cabeca.includes(ASSINATURA_PDF)) {
      resultado.push({ nome: a.nome, caminhoRelativo: a.caminhoRelativo, motivo: 'não é um arquivo PDF' });
      continue;
    }
    const sha = createHash('sha256').update(a.bytes).digest('hex');
    const chave = chaveDoPdf(baseId, sha);
    if (!(await existeArquivo(chave))) await gravarArquivo(chave, a.bytes, 'application/pdf');
    const r = await registrarPdf(baseId, { nome_arquivo: a.nome, caminho_relativo: a.caminhoRelativo, sha256: sha, tamanho: a.bytes.length, tipo_declarado: a.tipo ?? null });
    resultado.push({ nome: a.nome, caminhoRelativo: a.caminhoRelativo, pdf_id: r.id, novo: r.novo });
  }
  if (arquivos.length) {
    await tocarBase(baseId);
    await iniciarIndexacao(baseId);
  }
  return resultado;
}

/** Como receberPdfsComIds, devolvendo só as contagens (Bater PDF). */
export async function receberPdfs(baseId: string, arquivos: PdfRecebido[]) {
  const resultado = { novos: 0, repetidos: 0, recusados: [] as { nome: string; motivo: string }[] };
  for (const g of await receberPdfsComIds(baseId, arquivos)) {
    if ('motivo' in g) resultado.recusados.push({ nome: g.nome, motivo: g.motivo });
    else if (g.novo) resultado.novos++;
    else resultado.repetidos++;
  }
  if (!arquivos.length) await tocarBase(baseId);
  return resultado;
}
