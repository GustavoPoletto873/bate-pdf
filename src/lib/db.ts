import { createClient, type Client, type InArgs, type InStatement, type Transaction } from '@libsql/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { aplicarEsquemas, ESQUEMAS } from './esquema';

/**
 * Banco do app: SQLite via libSQL. O mesmo código roda nos dois modos:
 *
 * - **Local** (padrão): arquivo `bate-pdf.db` na pasta de dados (BATE_PDF_DADOS ou ./data).
 * - **Nuvem** (Vercel): Turso, quando LASTRO_DB_URL / TURSO_DATABASE_URL apontam para
 *   `libsql://…` (com o token em LASTRO_DB_TOKEN / TURSO_AUTH_TOKEN).
 *
 * A interface imita a do `node:sqlite` (prepare → all/get/run), só que assíncrona: no Turso
 * cada consulta é uma ida à rede. Escritas em massa devem usar `lote` (uma ida só).
 */

export function pastaDeDados(): string {
  return process.env.BATE_PDF_DADOS || join(process.cwd(), 'data');
}

export function pastaDePdfs(baseId: string): string {
  return join(pastaDeDados(), 'pdfs', baseId);
}

export type Valor = string | number | bigint | boolean | null | Uint8Array | ArrayBuffer;
export type Linha = Record<string, unknown>;
export type Resultado = { changes: number; lastInsertRowid: number };

export interface Consulta {
  all<T = Linha>(...args: Valor[]): Promise<T[]>;
  get<T = Linha>(...args: Valor[]): Promise<T | undefined>;
  run(...args: Valor[]): Promise<Resultado>;
}

export interface Banco {
  prepare(sql: string): Consulta;
  /** Vários comandos SQL separados por `;` (DDL, PRAGMAs). */
  exec(sql: string): Promise<void>;
  /** Escritas em massa numa ida só (e numa transação, se o banco não estiver numa). */
  lote(comandos: { sql: string; args?: Valor[] }[]): Promise<Resultado[]>;
}

type Executor = Pick<Client, 'execute' | 'executeMultiple' | 'batch'> | Transaction;

/** URL do banco: Turso na nuvem; senão o arquivo local. */
export function urlDoBanco(): { url: string; authToken?: string; remoto: boolean } {
  const remota = process.env.LASTRO_DB_URL?.trim() || process.env.TURSO_DATABASE_URL?.trim();
  if (remota) return { url: remota, authToken: (process.env.LASTRO_DB_TOKEN || process.env.TURSO_AUTH_TOKEN)?.trim(), remoto: !remota.startsWith('file:') };
  return { url: 'file:' + join(pastaDeDados(), 'bate-pdf.db').replace(/\\/g, '/'), remoto: false };
}

const linhas = (r: { columns: string[]; rows: ArrayLike<unknown>[] }): Linha[] =>
  r.rows.map((row) => {
    const o: Linha = {};
    for (let i = 0; i < r.columns.length; i++) o[r.columns[i]] = (row as unknown as unknown[])[i];
    return o;
  });

const resultado = (r: { rowsAffected: number; lastInsertRowid?: bigint }): Resultado => ({
  changes: r.rowsAffected,
  lastInsertRowid: r.lastInsertRowid === undefined ? 0 : Number(r.lastInsertRowid),
});

const argumentos = (args: Valor[]): InArgs => args.map((a) => (a === undefined ? null : a)) as InArgs;

/*
 * Modo local: o arquivo tem uma conexão só, e cada uso dela entra numa fila (uma transação
 * ocupa a vez até o commit). O driver local é síncrono: com duas conexões, uma consulta
 * esperando o lock de uma transação aberta na outra trava o event loop e a transação nunca
 * termina; com uma conexão sem fila, o libSQL recusa (TRANSACTION_ACTIVE) em vez de esperar.
 * No Turso não há fila: cada consulta é uma ida à rede e o servidor cuida da concorrência.
 */
const dentroDaTransacao = new AsyncLocalStorage<true>();
type Fila = { ultima: Promise<unknown> };

function naVez<T>(fila: Fila, fn: () => Promise<T>): Promise<T> {
  if (dentroDaTransacao.getStore()) {
    // Esperaria a própria transação terminar: travaria para sempre.
    return Promise.reject(new Error('Dentro de transacao() use só o tx recebido, não db().'));
  }
  const r = fila.ultima.then(fn, fn);
  fila.ultima = r.catch(() => undefined);
  return r;
}

function banco(ex: Executor, emTransacao: boolean, fila: Fila | null): Banco {
  const vez = <T>(fn: () => Promise<T>) => (fila ? naVez(fila, fn) : fn());
  return {
    prepare(sql) {
      return {
        async all<T>(...args: Valor[]) {
          return linhas(await vez(() => ex.execute({ sql, args: argumentos(args) }))) as T[];
        },
        async get<T>(...args: Valor[]) {
          return linhas(await vez(() => ex.execute({ sql, args: argumentos(args) })))[0] as T | undefined;
        },
        async run(...args: Valor[]) {
          return resultado(await vez(() => ex.execute({ sql, args: argumentos(args) })));
        },
      };
    },
    async exec(sql) {
      await vez(() => ex.executeMultiple(sql));
    },
    async lote(comandos) {
      if (!comandos.length) return [];
      const stmts: InStatement[] = comandos.map((c) => ({ sql: c.sql, args: argumentos(c.args ?? []) }));
      const rs = await vez(() => (emTransacao ? (ex as Transaction).batch(stmts) : (ex as Client).batch(stmts, 'write')));
      return rs.map(resultado);
    },
  };
}

type Conexao = { cliente: Client; pronto: Promise<Banco>; fila: Fila | null };
type Global = typeof globalThis & { __lastroDb?: Conexao };

function cliente(): Conexao {
  const g = globalThis as Global;
  if (!g.__lastroDb) {
    const { url, authToken, remoto } = urlDoBanco();
    if (!remoto) mkdirSync(pastaDeDados(), { recursive: true });
    // Local: uma conexão só, com fila (ver naVez). O timeout é o busy_timeout dela (o indexador
    // grava no mesmo arquivo a partir de outro processo).
    const c = createClient({ url, authToken, ...(remoto ? {} : { timeout: 10000, concurrency: 1 }) });
    const fila: Fila | null = remoto ? null : { ultima: Promise.resolve() };
    const b = banco(c, false, fila);
    const pronto = (async () => {
      if (!remoto) await b.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL;');
      await b.exec('PRAGMA foreign_keys = ON');
      await aplicarEsquemas(b);
      return b;
    })();
    // Se a preparação falhar (banco fora do ar), a próxima chamada tenta de novo.
    pronto.catch(() => { if (g.__lastroDb?.pronto === pronto) g.__lastroDb = undefined; });
    g.__lastroDb = { cliente: c, pronto, fila };
  }
  return g.__lastroDb;
}

/** O banco, já com o esquema aplicado. */
export function db(): Promise<Banco> {
  return cliente().pronto;
}

/**
 * Roda `fn` numa transação de escrita. Dentro dela use **só** o `tx` recebido: no modo local a
 * transação ocupa a vez da conexão até o fim, e uma chamada a db() lá dentro dá erro.
 */
export async function transacao<T>(fn: (tx: Banco) => Promise<T>): Promise<T> {
  await db();
  const { cliente: c, fila } = cliente();
  const rodar = async () => {
    const t = await c.transaction('write');
    try {
      const r = await dentroDaTransacao.run(true, () => fn(banco(t, true, null)));
      await t.commit();
      return r;
    } catch (e) {
      await t.rollback().catch(() => undefined);
      throw e;
    } finally {
      t.close();
    }
  };
  return fila ? naVez(fila, rodar) : rodar();
}

/**
 * INSERT de muitas linhas: um comando por bloco (várias linhas por comando) e todos os blocos
 * numa ida só (`lote`). `sufixo` vai no fim de cada comando (ex.: ON CONFLICT …).
 */
export async function inserirVarios(c: Banco, tabela: string, colunas: string[], linhas: Valor[][], sufixo = ''): Promise<void> {
  if (!linhas.length) return;
  // ~400 valores por comando: longe do limite de parâmetros do SQLite e de payload do Turso.
  const porComando = Math.max(1, Math.floor(400 / colunas.length));
  const grupo = `(${colunas.map(() => '?').join(', ')})`;
  const comandos: { sql: string; args: Valor[] }[] = [];
  for (let i = 0; i < linhas.length; i += porComando) {
    const bloco = linhas.slice(i, i + porComando);
    comandos.push({
      sql: `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${bloco.map(() => grupo).join(', ')}${sufixo ? ' ' + sufixo : ''}`,
      args: bloco.flat(),
    });
  }
  // Lotes de até 200 comandos por ida (um envio enorme também é ruim no Turso).
  for (let i = 0; i < comandos.length; i += 200) await c.lote(comandos.slice(i, i + 200));
}

/**
 * Reserva `quantos` ids seguidos numa tabela com AUTOINCREMENT (dentro de uma transação de
 * escrita): devolve o primeiro. Permite gravar linhas relacionadas num lote só, sem ir ao banco
 * buscar cada id gerado.
 */
export async function reservarIds(tx: Banco, tabela: string, quantos: number): Promise<number> {
  const r = await tx.prepare(`SELECT MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?), 0), COALESCE((SELECT MAX(id) FROM ${tabela}), 0)) AS ultimo`)
    .get<{ ultimo: number }>(tabela);
  // Gravar com id explícito já atualiza o sqlite_sequence; aqui basta não reaproveitar ids
  // (o AUTOINCREMENT nunca reaproveita, por isso olha a sequência e não só o MAX).
  void quantos;
  return Number(r?.ultimo ?? 0) + 1;
}

type ChaveEstrangeira = { filho: string; coluna: string; pai: string; colunaPai: string; acao: string };
type GlobalFks = typeof globalThis & { __lastroFks?: Promise<ChaveEstrangeira[]> };

async function chavesEstrangeiras(c: Banco): Promise<ChaveEstrangeira[]> {
  const g = globalThis as GlobalFks;
  g.__lastroFks ??= c.prepare(`SELECT m.name AS filho, f."from" AS coluna, f."table" AS pai, COALESCE(f."to", 'id') AS colunaPai,
      UPPER(f.on_delete) AS acao FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table'`)
    .all<ChaveEstrangeira>()
    .catch((e) => { g.__lastroFks = undefined; throw e; });
  return g.__lastroFks;
}

/**
 * Os comandos que apagam as linhas de `tabela` que atendem `onde` **com** o efeito das chaves
 * estrangeiras do esquema (ON DELETE CASCADE / SET NULL), feitos pelo app: no Turso o
 * `PRAGMA foreign_keys` vale por conexão e o cliente remoto não garante a mesma conexão, então a
 * cascata não pode depender dele. Filhos antes dos pais; rodar com `lote` (atômico).
 */
export async function comandosDeExclusao(c: Banco, tabela: string, onde: string, args: Valor[]): Promise<{ sql: string; args: Valor[] }[]> {
  const fks = await chavesEstrangeiras(c);
  const comandos: { sql: string; args: Valor[] }[] = [];
  const montar = (t: string, cond: string, caminho: string[]) => {
    for (const fk of fks.filter((f) => f.pai === t)) {
      const dentro = `"${fk.coluna}" IN (SELECT "${fk.colunaPai}" FROM ${t} WHERE ${cond})`;
      if (fk.acao === 'CASCADE') {
        if (!caminho.includes(fk.filho)) montar(fk.filho, dentro, [...caminho, fk.filho]);
      } else if (fk.acao === 'SET NULL') {
        comandos.push({ sql: `UPDATE ${fk.filho} SET "${fk.coluna}" = NULL WHERE ${dentro}`, args });
      }
    }
    comandos.push({ sql: `DELETE FROM ${t} WHERE ${cond}`, args });
  };
  montar(tabela, onde, [tabela]);
  return comandos;
}

/** Apaga com a cascata do esquema (ver comandosDeExclusao), num lote atômico. */
export async function excluir(c: Banco, tabela: string, onde: string, args: Valor[]): Promise<void> {
  await c.lote(await comandosDeExclusao(c, tabela, onde, args));
}

/** Divide uma lista em blocos (para IN (…) com muitos ids). */
export function emBlocos<T>(lista: T[], tamanho = 500): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) r.push(lista.slice(i, i + tamanho));
  return r;
}

/** Banco SQLite em memória, sem esquema (testes). */
export function bancoEmMemoria(): Banco {
  return banco(createClient({ url: 'file::memory:' }), false, { ultima: Promise.resolve() });
}

/** Fecha a conexão (testes e scripts). */
export function fecharBanco(): void {
  const g = globalThis as Global;
  g.__lastroDb?.cliente.close();
  g.__lastroDb = undefined;
}

export const ESQUEMA_SQL = ESQUEMAS.map((e) => e.sql).join('\n');
