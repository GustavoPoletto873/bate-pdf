import { db, emBlocos } from '@/lib/db';

/**
 * Status de auditoria de uma base, com a mesma regra da Seleção de Auditoria do Bate Lastro
 * (routes/get/auditorias_selection.py): sem atividade = a iniciar; finalizada pelo usuário =
 * finalizada; o resto = em andamento. Lá "atividade" é ter linha em auditoria_progress (a base
 * foi processada); aqui é ter qualquer bate, pré-bate, marcação, leitura ou pré-classificação.
 */
export type StatusAuditoria = 'a_iniciar' | 'em_andamento' | 'finalizada';

export type ResumoAuditoria = {
  base_id: string;
  status: StatusAuditoria;
  /** Pendências (título × lado) da base, sem contar as que já vieram batidas do Bate Lastro. */
  total: number;
  /** Batidas aqui (vínculo) + já batidas no Bate Lastro. */
  batidas: number;
  pre_bates: number;
  pendentes: number;
  /** batidas / (batidas + pendentes), 0..1. */
  progresso: number;
  /** Último bate, pré-bate ou marcação (ISO), para "continue de onde parou". */
  ultima_atividade: string | null;
};

/** Resumo de várias bases com poucas consultas agregadas (o painel lê todas as bases de uma vez). */
export async function resumosDaAuditoria(baseIds: string[]): Promise<Map<string, ResumoAuditoria>> {
  const r = new Map<string, ResumoAuditoria>();
  const c = await db();
  // 5 listas de ids na consulta de atividade: blocos de 150 ficam longe do limite de parâmetros.
  for (const ids of emBlocos([...new Set(baseIds)], 150)) {
    const m = ids.map(() => '?').join(',');
    const bases = await c.prepare(`SELECT id, finalizada FROM bases WHERE id IN (${m})`).all<{ id: string; finalizada: number }>(...ids);
    if (!bases.length) continue;
    const pend = await c.prepare(`SELECT base_id, situacao, COUNT(*) n FROM pendencias WHERE base_id IN (${m}) GROUP BY base_id, situacao`)
      .all<{ base_id: string; situacao: string; n: number }>(...ids);
    const pre = new Map((await c.prepare(`SELECT base_id, COUNT(*) n FROM pre_matches WHERE base_id IN (${m}) GROUP BY base_id`)
      .all<{ base_id: string; n: number }>(...ids)).map((x) => [x.base_id, x.n]));
    const atividade = new Map((await c.prepare(`
      SELECT base_id, MAX(t) t FROM (
        SELECT p.base_id, MAX(v.criado_em) t FROM vinculos v JOIN pendencias p ON p.id = v.pendencia_id WHERE p.base_id IN (${m}) GROUP BY p.base_id
        UNION ALL SELECT base_id, MAX(criado_em) FROM pre_matches WHERE base_id IN (${m}) GROUP BY base_id
        UNION ALL SELECT p.base_id, MAX(mc.atualizado_em) FROM marcacoes mc JOIN pendencias p ON p.id = mc.pendencia_id WHERE p.base_id IN (${m}) GROUP BY p.base_id
        UNION ALL SELECT base_id, MAX(lida_em) FROM leituras WHERE base_id IN (${m}) GROUP BY base_id
        UNION ALL SELECT base_id, executado_em FROM pre_classificacoes WHERE base_id IN (${m})
      ) GROUP BY base_id`).all<{ base_id: string; t: string | null }>(...ids, ...ids, ...ids, ...ids, ...ids)).map((x) => [x.base_id, x.t]));
    for (const base of bases) {
      const n = (s: string) => pend.find((p) => p.base_id === base.id && p.situacao === s)?.n ?? 0;
      const vinculadas = n('vinculado');
      const pendentes = n('pendente');
      const batidas = vinculadas + n('ja_batido');
      const ultima = atividade.get(base.id) ?? null;
      const status: StatusAuditoria = base.finalizada ? 'finalizada' : ultima || vinculadas > 0 ? 'em_andamento' : 'a_iniciar';
      r.set(base.id, {
        base_id: base.id,
        status,
        total: vinculadas + pendentes,
        batidas,
        pre_bates: pre.get(base.id) ?? 0,
        pendentes,
        progresso: batidas + pendentes > 0 ? batidas / (batidas + pendentes) : 0,
        ultima_atividade: ultima,
      });
    }
  }
  return r;
}

export async function resumoDaAuditoria(baseId: string): Promise<ResumoAuditoria | null> {
  return (await resumosDaAuditoria([baseId])).get(baseId) ?? null;
}

/** Marca ou desmarca a auditoria como finalizada (Resultados › Status da Auditoria). */
export async function definirFinalizada(baseId: string, finalizada: boolean): Promise<void> {
  await (await db()).prepare('UPDATE bases SET finalizada = ?, finalizada_em = ? WHERE id = ?')
    .run(finalizada ? 1 : 0, finalizada ? new Date().toISOString() : null, baseId);
}
