import { describe, expect, test } from 'vitest';
import { bancoEmMemoria, comandosDeExclusao, excluir, type Banco } from '@/lib/db';
import { aplicarEsquemas } from './index';

const agora = '2026-01-01T00:00:00.000Z';

async function base(c: Banco, id: string) {
  await c.prepare("INSERT INTO bases (id, nome, origem, criado_em, atualizado_em) VALUES (?, ?, 'amostra', ?, ?)").run(id, `Base ${id}`, agora, agora);
  const t = await c.prepare('INSERT INTO titulos (base_id, linha_origem) VALUES (?, 1)').run(id);
  const p = await c.prepare("INSERT INTO pendencias (base_id, titulo_id, lado) VALUES (?, ?, 'lastro')").run(id, t.lastInsertRowid);
  await c.prepare("INSERT INTO marcacoes (pendencia_id, campo, valor, atualizado_em) VALUES (?, 'valor_total', 'V', ?)").run(p.lastInsertRowid, agora);
  const pdf = await c.prepare("INSERT INTO pdfs (base_id, nome_arquivo, sha256, tamanho, enviado_em) VALUES (?, 'a.pdf', ?, 10, ?)").run(id, `sha-${id}`, agora);
  await c.prepare("INSERT INTO paginas (pdf_id, numero, texto, texto_normalizado) VALUES (?, 1, 'NOTA FISCAL 123', 'nota fiscal 123')").run(pdf.lastInsertRowid);
  await c.prepare("INSERT INTO vinculos (pendencia_id, pdf_id, marcacoes, leitura, origem, criado_em) VALUES (?, ?, '{}', '{}', 'manual', ?)")
    .run(p.lastInsertRowid, pdf.lastInsertRowid, agora);
}

const contar = async (c: Banco, tabela: string) => (await c.prepare(`SELECT COUNT(*) n FROM ${tabela}`).get<{ n: number }>())!.n;

describe('exclusão em cascata feita pelo app (o Turso não garante PRAGMA foreign_keys)', () => {
  test('apagar a base leva títulos, pendências, marcações, PDFs, páginas (e a busca) e vínculos; a outra base fica', async () => {
    const c = bancoEmMemoria();
    await aplicarEsquemas(c);
    await c.exec('PRAGMA foreign_keys = OFF');
    await base(c, 'b1');
    await base(c, 'b2');

    await excluir(c, 'bases', 'id = ?', ['b1']);

    for (const t of ['bases', 'titulos', 'pendencias', 'marcacoes', 'pdfs', 'paginas', 'vinculos']) expect(await contar(c, t), t).toBe(1);
    expect((await c.prepare("SELECT COUNT(*) n FROM paginas_fts WHERE paginas_fts MATCH 'fiscal'").get<{ n: number }>())!.n).toBe(1);
    expect(await c.prepare("SELECT 1 FROM pendencias WHERE base_id = 'b1'").get()).toBeUndefined();
  });

  test('filhos antes dos pais', async () => {
    const c = bancoEmMemoria();
    await aplicarEsquemas(c);
    const cmds = (await comandosDeExclusao(c, 'bases', 'id = ?', ['x'])).map((x) => x.sql);
    const pos = (re: RegExp) => cmds.findIndex((s) => re.test(s));
    expect(pos(/^DELETE FROM marcacoes/)).toBeLessThan(pos(/^DELETE FROM pendencias/));
    expect(pos(/^DELETE FROM paginas/)).toBeLessThan(pos(/^DELETE FROM pdfs/));
    expect(pos(/^DELETE FROM bases/)).toBe(cmds.length - 1);
  });
});
