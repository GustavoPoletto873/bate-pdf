import { db } from '@/lib/db';
import { obterClienteGemini } from '@/lib/ia/cliente';
import { maxPaginasIa, modeloGemini, semSegredo } from '@/lib/ia/config';
import { contarPaginas } from './paginas';
import { LeituraRecusada, motivoDoErro, processarDocumento, type Dependencias } from './processamento';

/**
 * Fila local dos jobs de leitura (no lugar do SQS + worker do Bate Lastro): roda dentro do
 * servidor do Next, 2 jobs por vez. Job: pending → processing → done | failed.
 *
 * Ao iniciar o servidor, job que ficou 'processing' vira 'failed' ("Leitura interrompida")
 * e NÃO é refeito sozinho — cada chamada ao Gemini é cobrada, como no worker do Bate Lastro;
 * a pessoa usa "Tentar de novo". Os 'pending' continuam.
 */

export const CONCORRENCIA = 2;
export const MOTIVO_INTERROMPIDA = 'Leitura interrompida (o servidor foi reiniciado). Use “Tentar de novo”.';

type Estado = { iniciada: boolean; ativos: number; deps: Dependencias | null; ociosos: (() => void)[] };
type Global = typeof globalThis & { __batePdfFila?: Estado };

function estado(): Estado {
  const g = globalThis as Global;
  g.__batePdfFila ??= { iniciada: false, ativos: 0, deps: null, ociosos: [] };
  return g.__batePdfFila;
}

const agora = () => new Date().toISOString();

function dependenciasPadrao(): Dependencias {
  return { cliente: obterClienteGemini, contarPaginas, modelo: modeloGemini(), maxPaginas: maxPaginasIa() };
}

/** Troca as dependências (testes: cliente falso, contagem de páginas falsa). */
export function definirDependenciasFila(deps: Dependencias | null): void {
  estado().deps = deps;
}

/** Recuperação do início: o que estava rodando quando o servidor caiu vira falha. */
export function recuperarInterrompidos(): number {
  const c = db();
  const momento = agora();
  c.prepare(`UPDATE anexo_documentos SET status = 'erro', motivo = ?, atualizado_em = ?
    WHERE id IN (SELECT documento_id FROM jobs WHERE status = 'processing')`).run(MOTIVO_INTERROMPIDA, momento);
  const r = c.prepare("UPDATE jobs SET status = 'failed', erro = ?, atualizado_em = ? WHERE status = 'processing'").run(MOTIVO_INTERROMPIDA, momento);
  return Number(r.changes);
}

/** Uma vez por processo do servidor: recupera os interrompidos e retoma os pendentes. */
export function iniciarFila(): void {
  const e = estado();
  if (e.iniciada) return;
  e.iniciada = true;
  try {
    const n = recuperarInterrompidos();
    if (n) console.warn(`[fila de leitura] ${n} leitura(s) interrompida(s) marcadas como falha.`);
  } catch (erro) {
    console.error('[fila de leitura] não foi possível recuperar a fila:', erro);
  }
  chutarFila();
}

type JobPego = { id: number; documento_id: number };

function pegarProximo(): JobPego | null {
  return (db().prepare(`UPDATE jobs SET status = 'processing', tentativas = tentativas + 1, atualizado_em = ?
    WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND tipo = 'leitura_lastro' ORDER BY id LIMIT 1)
    RETURNING id, documento_id`).get(agora()) as JobPego | undefined) ?? null;
}

async function rodar(job: JobPego, deps: Dependencias): Promise<void> {
  try {
    const r = await processarDocumento(job.documento_id, deps);
    db().prepare("UPDATE jobs SET status = 'done', erro = NULL, resultado = ?, atualizado_em = ? WHERE id = ?")
      .run(JSON.stringify(r), agora(), job.id);
  } catch (e) {
    if (!(e instanceof LeituraRecusada)) console.error(`[fila de leitura] documento ${job.documento_id}:`, semSegredo(e instanceof Error ? e.stack ?? e.message : String(e)));
    db().prepare("UPDATE jobs SET status = 'failed', erro = ?, atualizado_em = ? WHERE id = ?").run(motivoDoErro(e), agora(), job.id);
  }
}

/** Dispara jobs pendentes até a concorrência. Chame depois de enfileirar. */
export function chutarFila(): void {
  const e = estado();
  if (!e.iniciada) {
    iniciarFila();
    return;
  }
  while (e.ativos < CONCORRENCIA) {
    let job: JobPego | null;
    try {
      job = pegarProximo();
    } catch (erro) {
      console.error('[fila de leitura] falha ao ler a fila:', erro);
      break;
    }
    if (!job) break;
    e.ativos++;
    const deps = e.deps ?? dependenciasPadrao();
    void rodar(job, deps).finally(() => {
      e.ativos--;
      chutarFila();
      if (e.ativos === 0) for (const ok of e.ociosos.splice(0)) ok();
    });
  }
  if (e.ativos === 0) for (const ok of e.ociosos.splice(0)) ok();
}

/** Espera a fila esvaziar (testes). */
export function aguardarFilaOciosa(): Promise<void> {
  const e = estado();
  if (e.ativos === 0) return Promise.resolve();
  return new Promise((ok) => e.ociosos.push(ok));
}

export function filaAtiva(): number {
  return estado().ativos;
}
