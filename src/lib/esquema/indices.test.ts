import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { aplicarEsquemas, ESQUEMAS } from './index';

const indices = (c: DatabaseSync, tabela: string) =>
  (c.prepare(`PRAGMA index_list(${tabela})`).all() as { name: string }[]).map((i) => i.name);

describe('índices', () => {
  test('as consultas quentes têm índice (inclusive em coluna acrescentada por migração)', () => {
    const c = new DatabaseSync(':memory:');
    aplicarEsquemas(c);
    expect(indices(c, 'vinculos')).toEqual(expect.arrayContaining(['idx_vinculos_leitura', 'idx_vinculos_pdf']));
    expect(indices(c, 'pendencias')).toContain('idx_pendencias_titulo');
    expect(indices(c, 'bases')).toContain('idx_bases_fundo');
    expect(indices(c, 'anexo_lotes')).toContain('idx_anexo_lotes_base');
    // "Esta leitura já foi usada?" usa o índice, sem varrer a tabela.
    const plano = (c.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM vinculos WHERE leitura_id = ?').all(1) as { detail: string }[]).map((p) => p.detail).join(' ');
    expect(plano).toMatch(/USING (COVERING )?INDEX idx_vinculos_leitura/);
  });

  test('banco antigo: o índice é criado depois que a migração acrescenta a coluna', () => {
    const c = new DatabaseSync(':memory:');
    // Versão antiga de `vinculos`, sem leitura_id: o índice no SQL principal quebraria aqui.
    c.exec('CREATE TABLE vinculos (id INTEGER PRIMARY KEY AUTOINCREMENT, pendencia_id INTEGER NOT NULL UNIQUE, pdf_id INTEGER, pagina INTEGER, marcacoes TEXT NOT NULL, leitura TEXT NOT NULL, origem TEXT NOT NULL, criado_em TEXT NOT NULL)');
    expect(() => aplicarEsquemas(c, ESQUEMAS)).not.toThrow();
    expect(indices(c, 'vinculos')).toContain('idx_vinculos_leitura');
  });
});
