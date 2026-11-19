import { db } from '@/lib/db';

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

export function resumoDaAuditoria(baseId: string): ResumoAuditoria | null {
  const c = db();
  const base = c.prepare('SELECT id, finalizada FROM bases WHERE id = ?').get(baseId) as { id: string; finalizada: number } | undefined;
  if (!base) return null;
  const pend = c.prepare('SELECT situacao, COUNT(*) n FROM pendencias WHERE base_id = ? GROUP BY situacao').all(baseId) as { situacao: string; n: number }[];
  const n = (s: string) => pend.find((p) => p.situacao === s)?.n ?? 0;
  const vinculadas = n('vinculado');
  const jaBatidas = n('ja_batido');
  const pendentes = n('pendente');
  const preBates = (c.prepare('SELECT COUNT(*) n FROM pre_matches WHERE base_id = ?').get(baseId) as { n: number }).n;
  const atividade = c.prepare(`
    SELECT MAX(t) t FROM (
      SELECT MAX(v.criado_em) t FROM vinculos v JOIN pendencias p ON p.id = v.pendencia_id WHERE p.base_id = ?
      UNION ALL SELECT MAX(criado_em) FROM pre_matches WHERE base_id = ?
      UNION ALL SELECT MAX(m.atualizado_em) FROM marcacoes m JOIN pendencias p ON p.id = m.pendencia_id WHERE p.base_id = ?
      UNION ALL SELECT MAX(lida_em) FROM leituras WHERE base_id = ?
      UNION ALL SELECT executado_em FROM pre_classificacoes WHERE base_id = ?
    )`).get(baseId, baseId, baseId, baseId, baseId) as { t: string | null };
  const batidas = vinculadas + jaBatidas;
  const status: StatusAuditoria = base.finalizada ? 'finalizada' : atividade.t || vinculadas > 0 ? 'em_andamento' : 'a_iniciar';
  return {
    base_id: baseId,
    status,
    total: vinculadas + pendentes,
    batidas,
    pre_bates: preBates,
    pendentes,
    progresso: batidas + pendentes > 0 ? batidas / (batidas + pendentes) : 0,
    ultima_atividade: atividade.t,
  };
}

/** Marca ou desmarca a auditoria como finalizada (Resultados › Status da Auditoria). */
export function definirFinalizada(baseId: string, finalizada: boolean): void {
  db().prepare('UPDATE bases SET finalizada = ?, finalizada_em = ? WHERE id = ?')
    .run(finalizada ? 1 : 0, finalizada ? new Date().toISOString() : null, baseId);
}
