import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Banco temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'lastro-dashboard-'));
let dash: typeof import('@/lib/dashboard');
let dbMod: typeof import('@/lib/db');
const AGORA = new Date('2026-11-19T15:00:00');

function base(id: string, o: { cnpj: string; nome: string; dataRef: string; criado: string; fundoId?: number; finalizada?: boolean; pend: [string, string][] }) {
  const c = dbMod.db();
  c.prepare(`INSERT INTO bases (id, nome, nome_fundo, cnpj_fundo, origem, criado_em, atualizado_em, data_referencia, fundo_id, finalizada)
    VALUES (?, ?, ?, ?, 'amostra', ?, ?, ?, ?, ?)`).run(id, id, o.nome, o.cnpj, o.criado, o.criado, o.dataRef, o.fundoId ?? null, o.finalizada ? 1 : 0);
  for (const [lado, situacao] of o.pend) {
    const t = Number(c.prepare("INSERT INTO titulos (base_id, numero_documento) VALUES (?, 'N')").run(id).lastInsertRowid);
    const p = Number(c.prepare('INSERT INTO pendencias (base_id, titulo_id, lado, situacao) VALUES (?, ?, ?, ?)').run(id, t, lado, situacao).lastInsertRowid);
    if (situacao === 'vinculado') {
      c.prepare("INSERT INTO vinculos (pendencia_id, marcacoes, leitura, origem, criado_em) VALUES (?, '{}', '{}', 'manual', ?)").run(p, new Date(AGORA.getTime() - 3600_000).toISOString());
    }
  }
}

beforeAll(async () => {
  dbMod = await import('@/lib/db');
  dash = await import('@/lib/dashboard');
  const c = dbMod.db();
  const ts = new Date().toISOString();
  c.prepare("INSERT INTO administradoras (nome, criado_em) VALUES ('PLANNER', ?), ('OUTRA', ?)").run(ts, ts);
  c.prepare("INSERT INTO fundos (nome, cnpj, administradora_id, criado_em, atualizado_em) VALUES ('FIDC ALFA', '11111111000111', 1, ?, ?)").run(ts, ts);
  base('a1', { cnpj: '11.111.111/0001-11', nome: 'Alfa antigo', dataRef: '2026-09-30', criado: '2026-10-01T10:00:00.000Z', pend: [['termo', 'pendente'], ['lastro', 'vinculado'], ['lastro', 'pendente']] });
  base('a2', { cnpj: '11111111000111', nome: 'Alfa', dataRef: '2026-08-31', criado: '2026-11-18T10:00:00.000Z', pend: [['lastro', 'pendente']] });
  base('b1', { cnpj: '22222222000122', nome: 'Beta', dataRef: '2026-09-15', criado: '2026-09-20T10:00:00.000Z', finalizada: true, pend: [['lastro', 'ja_batido']] });
  base('c1', { cnpj: '', nome: 'Sem CNPJ', dataRef: '2026-03-31', criado: '2026-04-01T10:00:00.000Z', pend: [['lastro', 'pendente']] });
});

describe('painel', () => {
  it('KPIs do 3º trimestre', () => {
    const p = dash.painel({ de: '2026-07-01', ate: '2026-09-30' }, AGORA);
    expect(p.resumo_executivo).toMatchObject({
      total_bases_disponiveis: 3, auditorias_a_iniciar: 1, auditorias_em_andamento: 1, auditorias_em_andamento_atrasadas: 1, auditorias_finalizadas: 1,
    });
    expect(p.metricas_bates).toEqual({ total_bates: 2, total_pendencias: 3, bates_hoje: 1 });
    expect(p.concluido_vs_pendente.concluido).toEqual({ quantidade: 2, percentual: 40 });
    expect(p.pendencias_por_tipo).toEqual({ termo: { quantidade: 1, percentual: 33.3 }, lastro: { quantidade: 2, percentual: 66.7 } });
  });

  it('agrupa por fundo (CNPJ, senão nome) com as bases', () => {
    const p = dash.painel({}, AGORA);
    const alfa = p.fundos.find((f) => f.fundo_chave === '11111111000111')!;
    expect(alfa).toMatchObject({ nome_fundo: 'FIDC ALFA', administradora: 'PLANNER', total_bases: 2, auditorias_iniciadas: 1, total_bates: 1, pend_termo: 1, pend_lastro: 2, cobertura: 25 });
    expect(alfa.bases.map((b) => b.base_id)).toEqual(['a1', 'a2']);
    expect(p.fundos.find((f) => f.fundo_chave === 'SEM CNPJ')?.total_bases).toBe(1);
    expect(p.fundos[0].fundo_chave).toBe('11111111000111'); // mais pendências primeiro
  });

  it('filtra pela administradora (pelo CNPJ do cadastro) e data exata', () => {
    expect(dash.painel({ administradoraId: 1 }, AGORA).resumo_executivo.total_bases_disponiveis).toBe(2);
    expect(dash.painel({ administradoraId: 2 }, AGORA).resumo_executivo.total_bases_disponiveis).toBe(0);
    expect(dash.painel({ de: '2026-08-31', ate: '2026-08-31' }, AGORA).fundos.map((f) => f.bases.map((b) => b.base_id))).toEqual([['a2']]);
    expect(dash.administradoras().map((a) => a.nome)).toEqual(['OUTRA', 'PLANNER']);
  });
});
