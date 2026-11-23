import { after } from 'next/server';
import { armazenamentoNaNuvem } from '@/lib/arquivos';
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
 *
 * Na nuvem (Vercel) não há servidor contínuo: a fila trabalha depois da resposta da requisição que
 * a chutou (`after`), sem pegar job novo depois de um prazo, e é retomada quando alguém acompanha
 * o lote (as rotas chamam iniciarFila). Várias instâncias podem puxar ao mesmo tempo: pegar um job
 * é atômico. Job 'processing' só vira falha se ficou largado (instância que morreu).
 */

const naNuvem = () => Boolean(process.env.VERCEL) || armazenamentoNaNuvem();
/** Na nuvem: por quanto tempo uma requisição pega jobs novos (a rota tem maxDuration maior). */
const PRAZO_MS = Number(process.env.FILA_ORCAMENTO_MS || 180_000);
/** Na nuvem: job 'processing' parado há mais que isto foi largado. */
const LARGADO_MS = 15 * 60_000;

export const CONCORRENCIA = 2;
export const MOTIVO_INTERROMPIDA = 'Leitura interrompida (o servidor foi reiniciado). Use “Tentar de novo”.';

type Estado = { prazo?: number; iniciada: boolean; inicio?: Promise<void>; puxando: boolean; denovo: boolean; ativos: number; deps: Dependencias | null; ociosos: (() => void)[] };
type Global = typeof globalThis & { __batePdfFila?: Estado };

function estado(): Estado {
  const g = globalThis as Global;
  g.__batePdfFila ??= { iniciada: false, puxando: false, denovo: false, ativos: 0, deps: null, ociosos: [] };
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
export async function recuperarInterrompidos(): Promise<number> {
  const c = await db();
  const momento = agora();
  // Na nuvem outra instância pode estar lendo agora: só o que ficou parado tempo demais.
  const largado = naNuvem() ? ' AND atualizado_em < ?' : '';
  const args = naNuvem() ? [new Date(Date.now() - LARGADO_MS).toISOString()] : [];
  await c.prepare(`UPDATE anexo_documentos SET status = 'erro', motivo = ?, atualizado_em = ?
    WHERE id IN (SELECT documento_id FROM jobs WHERE status = 'processing'${largado})`).run(MOTIVO_INTERROMPIDA, momento, ...args);
  const r = await c.prepare(`UPDATE jobs SET status = 'failed', erro = ?, atualizado_em = ? WHERE status = 'processing'${largado}`).run(MOTIVO_INTERROMPIDA, momento, ...args);
  return Number(r.changes);
}

/** Uma vez por processo do servidor: recupera os interrompidos e retoma os pendentes. */
export function iniciarFila(): Promise<void> {
  const e = estado();
  if (naNuvem()) return retomarNaNuvem();
  e.inicio ??= (async () => {
    try {
      const n = await recuperarInterrompidos();
      if (n) console.warn(`[fila de leitura] ${n} leitura(s) interrompida(s) marcadas como falha.`);
    } catch (erro) {
      console.error('[fila de leitura] não foi possível recuperar a fila:', erro);
    }
    e.iniciada = true;
    await puxar();
  })();
  return e.inicio;
}

/** Nuvem: a cada acompanhamento, devolve os largados e puxa os pendentes durante esta requisição. */
async function retomarNaNuvem(): Promise<void> {
  try {
    const n = await recuperarInterrompidos();
    if (n) console.warn(`[fila de leitura] ${n} leitura(s) largada(s) marcadas como falha.`);
  } catch (erro) {
    console.error('[fila de leitura] não foi possível recuperar a fila:', erro);
  }
  estado().iniciada = true;
  chutarFila();
}

type JobPego = { id: number; documento_id: number };

async function pegarProximo(): Promise<JobPego | null> {
  const prazo = estado().prazo;
  if (naNuvem() && prazo !== undefined && Date.now() > prazo) return null;
  return (await (await db()).prepare(`UPDATE jobs SET status = 'processing', tentativas = tentativas + 1, atualizado_em = ?
    WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND tipo = 'leitura_lastro' ORDER BY id LIMIT 1)
    RETURNING id, documento_id`).get<JobPego>(agora())) ?? null;
}

async function rodar(job: JobPego, deps: Dependencias): Promise<void> {
  try {
    const r = await processarDocumento(job.documento_id, deps);
    await (await db()).prepare("UPDATE jobs SET status = 'done', erro = NULL, resultado = ?, atualizado_em = ? WHERE id = ?")
      .run(JSON.stringify(r), agora(), job.id);
  } catch (e) {
    if (!(e instanceof LeituraRecusada)) console.error(`[fila de leitura] documento ${job.documento_id}:`, semSegredo(e instanceof Error ? e.stack ?? e.message : String(e)));
    await (await db()).prepare("UPDATE jobs SET status = 'failed', erro = ?, atualizado_em = ? WHERE id = ?").run(motivoDoErro(e), agora(), job.id);
  }
}

/** Dispara jobs pendentes até a concorrência. Chame depois de enfileirar (não precisa esperar). */
export function chutarFila(): void {
  const e = estado();
  if (naNuvem()) {
    e.iniciada = true;
    e.prazo = Math.max(e.prazo ?? 0, Date.now() + PRAZO_MS);
    void puxar();
    // A função só fica viva enquanto a requisição dura: espera as leituras em andamento.
    try { after(() => aguardarFilaOciosa()); } catch { /* fora de requisição */ }
    return;
  }
  if (!e.iniciada) {
    void iniciarFila();
    return;
  }
  void puxar();
}

/** Pega jobs até a concorrência; uma execução por vez (pegar o próximo agora é assíncrono). */
async function puxar(): Promise<void> {
  const e = estado();
  if (e.puxando) {
    e.denovo = true;
    return;
  }
  e.puxando = true;
  try {
    do {
      e.denovo = false;
      while (e.ativos < CONCORRENCIA) {
        let job: JobPego | null;
        try {
          job = await pegarProximo();
        } catch (erro) {
          console.error('[fila de leitura] falha ao ler a fila:', erro);
          break;
        }
        if (!job) break;
        e.ativos++;
        const deps = e.deps ?? dependenciasPadrao();
        void rodar(job, deps).finally(() => {
          e.ativos--;
          void puxar();
        });
      }
    } while (e.denovo);
  } finally {
    e.puxando = false;
  }
  if (e.ativos === 0) for (const ok of e.ociosos.splice(0)) ok();
}

/** Espera a fila esvaziar (testes). */
export async function aguardarFilaOciosa(): Promise<void> {
  const e = estado();
  if (e.inicio) await e.inicio;
  // Espera também um "puxar" em andamento (ele pode estar pegando o próximo job).
  if (e.ativos === 0 && !e.puxando) return;
  return new Promise((ok) => e.ociosos.push(ok));
}

export function filaAtiva(): number {
  return estado().ativos;
}
