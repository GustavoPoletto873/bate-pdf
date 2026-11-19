import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { aplicarEsquemas, ESQUEMAS } from './esquema';

/**
 * Banco local (SQLite embutido no Node, `node:sqlite`). Tudo do app mora em
 * uma pasta de dados: o arquivo do banco e os PDFs enviados.
 *
 * Pasta: BATE_PDF_DADOS (variável de ambiente) ou ./data na raiz do projeto.
 */

export function pastaDeDados(): string {
  return process.env.BATE_PDF_DADOS || join(process.cwd(), 'data');
}

export function pastaDePdfs(baseId: string): string {
  return join(pastaDeDados(), 'pdfs', baseId);
}

type Global = typeof globalThis & { __batePdfDb?: DatabaseSync };

export function db(): DatabaseSync {
  const g = globalThis as Global;
  if (!g.__batePdfDb) {
    mkdirSync(pastaDeDados(), { recursive: true });
    const conexao = new DatabaseSync(join(pastaDeDados(), 'bate-pdf.db'));
    conexao.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL;');
    aplicarEsquemas(conexao);
    g.__batePdfDb = conexao;
  }
  return g.__batePdfDb;
}

/** Roda `fn` numa transação (BEGIN IMMEDIATE: o indexador escreve em outro processo). */
export function transacao<T>(fn: () => T): T {
  const c = db();
  c.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    c.exec('COMMIT');
    return r;
  } catch (e) {
    c.exec('ROLLBACK');
    throw e;
  }
}

export const ESQUEMA_SQL = ESQUEMAS.map((e) => e.sql).join('\n');
