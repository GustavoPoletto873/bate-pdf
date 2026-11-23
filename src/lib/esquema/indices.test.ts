import { describe, expect, test } from 'vitest';
import { bancoEmMemoria, type Banco } from '@/lib/db';
import { aplicarEsquemas, ESQUEMAS } from './index';

const indices = async (c: Banco, tabela: string) =>
  (await c.prepare(`PRAGMA index_list(${tabela})`).all<{ name: string }>()).map((i) => i.name);

describe('índices', () => {
  test('as consultas quentes têm índice (inclusive em coluna acrescentada por migração)', async () => {
    const c = bancoEmMemoria();
    await aplicarEsquemas(c);
    expect(await indices(c, 'vinculos')).toEqual(expect.arrayContaining(['idx_vinculos_leitura', 'idx_vinculos_pdf']));
    expect(await indices(c, 'pendencias')).toContain('idx_pendencias_titulo');
    expect(await indices(c, 'bases')).toContain('idx_bases_fundo');
    expect(await indices(c, 'anexo_lotes')).toContain('idx_anexo_lotes_base');
    // "Esta leitura já foi usada?" usa o índice, sem varrer a tabela.
    const plano = (await c.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM vinculos WHERE leitura_id = ?').all<{ detail: string }>(1)).map((p) => p.detail).join(' ');
    expect(plano).toMatch(/USING (COVERING )?INDEX idx_vinculos_leitura/);
  });

  test('banco antigo: o índice é criado depois que a migração acrescenta a coluna', async () => {
    const c = bancoEmMemoria();
    // Versão antiga de `vinculos`, sem leitura_id: o índice no SQL principal quebraria aqui.
    await c.exec('CREATE TABLE vinculos (id INTEGER PRIMARY KEY AUTOINCREMENT, pendencia_id INTEGER NOT NULL UNIQUE, pdf_id INTEGER, pagina INTEGER, marcacoes TEXT NOT NULL, leitura TEXT NOT NULL, origem TEXT NOT NULL, criado_em TEXT NOT NULL)');
    await aplicarEsquemas(c, ESQUEMAS); // não lança
    expect(await indices(c, 'vinculos')).toContain('idx_vinculos_leitura');
  });
});
