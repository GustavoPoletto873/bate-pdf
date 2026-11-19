import type { DatabaseSync } from 'node:sqlite';
import { ANEXO } from './anexo';
import { CADASTROS } from './cadastros';
import { LEITURAS } from './leituras';
import { MONITORAMENTO } from './monitoramento';
import { NUCLEO } from './nucleo';
import type { Esquema } from './tipos';

export type { ColunaNova, Esquema } from './tipos';

/**
 * Todos os módulos, na ordem em que as tabelas são criadas. Cada módulo do app (como as "pastas"
 * do menu do Bate Lastro) cuida do seu arquivo aqui; para acrescentar uma coluna numa tabela que
 * já existe em bancos antigos, use `colunas` (ALTER TABLE só quando falta).
 */
export const ESQUEMAS: Esquema[] = [NUCLEO, CADASTROS, ANEXO, LEITURAS, MONITORAMENTO];

export function aplicarEsquemas(conexao: DatabaseSync, esquemas: Esquema[] = ESQUEMAS): void {
  for (const e of esquemas) conexao.exec(e.sql);
  for (const e of esquemas) {
    for (const c of e.colunas ?? []) {
      const existentes = conexao.prepare(`PRAGMA table_info(${c.tabela})`).all() as { name: string }[];
      if (!existentes.some((x) => x.name === c.coluna)) conexao.exec(`ALTER TABLE ${c.tabela} ADD COLUMN ${c.coluna} ${c.definicao}`);
    }
  }
}
