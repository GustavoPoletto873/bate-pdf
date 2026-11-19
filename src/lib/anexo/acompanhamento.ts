import { db } from '@/lib/db';

/**
 * Análise › Lotes (routes/get/acompanhamento_simplificado.py do Bate Lastro): os jobs
 * 'pending' e 'processing' agrupados por base, com os totais. A versão local mostra também
 * os documentos com erro de cada base, para usar "Tentar de novo".
 */

export type DocumentoComErro = { id: number; caminho: string; motivo: string | null; tipo_documento: string | null; atualizado_em: string };

export type BaseEmAcompanhamento = {
  base_id: string;
  nome: string | null;
  nome_fundo: string | null;
  data_referencia: string | null;
  modo_referencia: string | null;
  totais: { pending: number; processing: number; total: number };
  percentuais: { pending: number; processing: number };
  erros: number;
  ultimos_erros: DocumentoComErro[];
  atualizado_em: string | null;
};

export type Acompanhamento = {
  totais: { pending: number; processing: number; total: number; erros: number };
  bases: BaseEmAcompanhamento[];
  total_bases: number;
  pagina: number;
  por_pagina: number;
  tem_mais: boolean;
};

const MAX_ERROS_POR_BASE = 5;

export function acompanhamentoLotes(opcoes: { pagina?: number; porPagina?: number } = {}): Acompanhamento {
  const c = db();
  const porPagina = Math.min(50, Math.max(1, opcoes.porPagina ?? 10));
  const pagina = Math.max(1, opcoes.pagina ?? 1);
  const ativos = c.prepare(`SELECT base_id, SUM(status = 'pending') pending, SUM(status = 'processing') processing, MAX(atualizado_em) atualizado_em
    FROM jobs WHERE status IN ('pending', 'processing') AND base_id IS NOT NULL GROUP BY base_id`).all() as
    { base_id: string; pending: number; processing: number; atualizado_em: string }[];
  const erros = c.prepare(`SELECT l.base_id, COUNT(*) n, MAX(d.atualizado_em) atualizado_em FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id
    WHERE d.status = 'erro' AND l.base_id IS NOT NULL GROUP BY l.base_id`).all() as { base_id: string; n: number; atualizado_em: string }[];

  const porBase = new Map<string, { pending: number; processing: number; erros: number; atualizado_em: string | null }>();
  for (const a of ativos) porBase.set(a.base_id, { pending: a.pending, processing: a.processing, erros: 0, atualizado_em: a.atualizado_em });
  for (const e of erros) {
    const atual = porBase.get(e.base_id) ?? { pending: 0, processing: 0, erros: 0, atualizado_em: null };
    atual.erros = e.n;
    if (!atual.atualizado_em || e.atualizado_em > atual.atualizado_em) atual.atualizado_em = e.atualizado_em;
    porBase.set(e.base_id, atual);
  }

  // Mais ativas primeiro (como o Bate Lastro); depois as que só têm erro, pela mais recente.
  const ordenadas = [...porBase.entries()].sort(([, a], [, b]) => {
    const ta = a.pending + a.processing;
    const tb = b.pending + b.processing;
    if ((ta > 0) !== (tb > 0)) return ta > 0 ? -1 : 1;
    if (ta !== tb) return tb - ta;
    return (b.atualizado_em ?? '').localeCompare(a.atualizado_em ?? '');
  });
  const fatia = ordenadas.slice((pagina - 1) * porPagina, pagina * porPagina);
  const meta = c.prepare('SELECT nome, nome_fundo, data_referencia, modo_referencia FROM bases WHERE id = ?');
  const ultimos = c.prepare(`SELECT d.id, d.caminho, d.motivo, d.tipo_documento, d.atualizado_em FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id
    WHERE l.base_id = ? AND d.status = 'erro' ORDER BY d.atualizado_em DESC LIMIT ${MAX_ERROS_POR_BASE}`);

  const bases: BaseEmAcompanhamento[] = fatia.map(([baseId, v]) => {
    const m = (meta.get(baseId) as { nome: string; nome_fundo: string | null; data_referencia: string | null; modo_referencia: string | null } | undefined);
    const total = v.pending + v.processing;
    const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
    return {
      base_id: baseId,
      nome: m?.nome ?? null,
      nome_fundo: m?.nome_fundo ?? null,
      data_referencia: m?.data_referencia ?? null,
      modo_referencia: m?.modo_referencia ?? null,
      totais: { pending: v.pending, processing: v.processing, total },
      percentuais: { pending: pct(v.pending), processing: pct(v.processing) },
      erros: v.erros,
      ultimos_erros: v.erros ? (ultimos.all(baseId) as DocumentoComErro[]) : [],
      atualizado_em: v.atualizado_em,
    };
  });

  const pending = ativos.reduce((s, a) => s + a.pending, 0);
  const processing = ativos.reduce((s, a) => s + a.processing, 0);
  return {
    totais: { pending, processing, total: pending + processing, erros: erros.reduce((s, e) => s + e.n, 0) },
    bases,
    total_bases: ordenadas.length,
    pagina,
    por_pagina: porPagina,
    tem_mais: pagina * porPagina < ordenadas.length,
  };
}
