import { db, emBlocos } from '@/lib/db';
import { resumosDaAuditoria, type StatusAuditoria } from '@/lib/auditoria';
import { digitos } from '@/lib/texto';

/**
 * Análise › Dashboard — porta do routes/get/auditoria_dashboard.py do Bate Lastro (endpoints
 * /v1/dashboard/auditoria, /fundos, /recentes e /administradoras) para o banco local.
 *
 * - Bases do período: pela data de referência da base (`base_ids_periodo_cte`), sem período = todas.
 * - Status de cada base: `resumoDaAuditoria` (a iniciar / em andamento / finalizada).
 * - Bates = vínculos + já batidos no Bate Lastro; pendências = pendências ainda pendentes.
 * - "Em andamento há mais de 15 dias": em andamento e base criada há mais de 15 dias.
 * Fica de fora o que não faz sentido aqui: aba de usuários (um usuário só), modo Entrada,
 * atualização automática e exclusão de base pelo painel.
 */

export const DIAS_LIMITE_ATRASO = 15;

export type FiltroPainel = { de?: string | null; ate?: string | null; administradoraId?: number | null };

export type BasePainel = {
  base_id: string;
  nome: string;
  data_referencia: string | null;
  criado_em: string;
  status: StatusAuditoria;
  total_bates: number;
  pend_termo: number;
  pend_lastro: number;
  total_pendencias: number;
  pre_bates: number;
  progresso: number;
  ultima_atividade: string | null;
};

export type FundoPainel = {
  fundo_chave: string;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  administradora: string | null;
  total_bases: number;
  auditorias_iniciadas: number;
  total_bates: number;
  pend_termo: number;
  pend_lastro: number;
  total_pendencias: number;
  /** bates / (bates + pendências), 0..100. */
  cobertura: number;
  ultima_atividade: string | null;
  bases: BasePainel[];
};

export type Painel = {
  periodo: { de: string | null; ate: string | null };
  administradora_id: number | null;
  atualizado_em: string;
  resumo_executivo: {
    auditorias_a_iniciar: number;
    auditorias_em_andamento: number;
    auditorias_em_andamento_atrasadas: number;
    dias_limite_atraso: number;
    auditorias_finalizadas: number;
    total_bases_disponiveis: number;
    taxa_cobertura: number;
  };
  metricas_bates: { total_bates: number; total_pendencias: number; bates_hoje: number };
  concluido_vs_pendente: { concluido: { quantidade: number; percentual: number }; pendente: { quantidade: number; percentual: number } };
  pendencias_por_tipo: { termo: { quantidade: number; percentual: number }; lastro: { quantidade: number; percentual: number } };
  fundos: FundoPainel[];
};

export type Administradora = { id: number; nome: string };

const pct = (parte: number, total: number) => (total ? Math.round((parte / total) * 1000) / 10 : 0);

export async function administradoras(): Promise<Administradora[]> {
  return (await db()).prepare('SELECT id, nome FROM administradoras ORDER BY nome COLLATE NOCASE').all<Administradora>();
}

type LinhaBase = {
  id: string; nome: string; nome_fundo: string | null; cnpj_fundo: string | null; data_referencia: string | null; criado_em: string;
  fundo_id: number | null; f_nome: string | null; f_cnpj: string | null; f_adm_id: number | null; f_adm: string | null;
};

/** Início do dia de hoje (no fuso deste computador), em ISO UTC, para comparar com `criado_em`. */
export function inicioDeHoje(agora = new Date()): string {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
}

export async function painel(filtro: FiltroPainel = {}, agora = new Date()): Promise<Painel> {
  const c = await db();
  const fundosPorCnpj = new Map(((await c.prepare(`SELECT f.id, f.nome, f.cnpj, f.administradora_id, a.nome AS adm FROM fundos f
      LEFT JOIN administradoras a ON a.id = f.administradora_id`).all()) as { id: number; nome: string; cnpj: string; administradora_id: number | null; adm: string | null }[])
    .map((f) => [f.cnpj, f]));
  const de = filtro.de || null;
  const ate = filtro.ate || null;
  const condicoes: string[] = [];
  const params: string[] = [];
  if (de) { condicoes.push('b.data_referencia >= ?'); params.push(de); }
  if (ate) { condicoes.push('substr(b.data_referencia, 1, 10) <= ?'); params.push(ate); }
  const linhas = await c.prepare(`
    SELECT b.id, b.nome, b.nome_fundo, b.cnpj_fundo, b.data_referencia, b.criado_em, b.fundo_id,
           f.nome AS f_nome, f.cnpj AS f_cnpj, f.administradora_id AS f_adm_id, a.nome AS f_adm
      FROM bases b LEFT JOIN fundos f ON f.id = b.fundo_id LEFT JOIN administradoras a ON a.id = f.administradora_id
     ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}`).all<LinhaBase>(...params);

  // Fundo da base: o cadastrado; sem ele, o do cadastro com o mesmo CNPJ (como o filtro do Bate Lastro).
  const comFundo = linhas.map((b) => {
    const cad = b.fundo_id ? null : fundosPorCnpj.get(digitos(b.cnpj_fundo));
    return {
      ...b,
      nomeFundo: b.f_nome ?? cad?.nome ?? b.nome_fundo,
      cnpj: digitos(b.f_cnpj ?? b.cnpj_fundo) || null,
      admId: b.f_adm_id ?? cad?.administradora_id ?? null,
      adm: b.f_adm ?? cad?.adm ?? null,
    };
  }).filter((b) => !filtro.administradoraId || b.admId === filtro.administradoraId);

  const ids = comFundo.map((b) => b.id);
  const porLado = new Map<string, { termo: number; lastro: number }>();
  const hoje = inicioDeHoje(agora);
  let batesHoje = 0;
  for (const bloco of emBlocos(ids)) {
    const marcas = bloco.map(() => '?').join(',');
    for (const r of await c.prepare(`SELECT base_id, lado, COUNT(*) n FROM pendencias WHERE situacao = 'pendente' AND base_id IN (${marcas}) GROUP BY base_id, lado`)
      .all<{ base_id: string; lado: 'termo' | 'lastro'; n: number }>(...bloco)) {
      const atual = porLado.get(r.base_id) ?? { termo: 0, lastro: 0 };
      atual[r.lado] = r.n;
      porLado.set(r.base_id, atual);
    }
    batesHoje += (await c.prepare(`SELECT COUNT(*) n FROM vinculos v JOIN pendencias p ON p.id = v.pendencia_id
        WHERE p.base_id IN (${marcas}) AND v.criado_em >= ?`).get<{ n: number }>(...bloco, hoje))!.n;
  }

  const limiteAtraso = new Date(agora.getTime() - DIAS_LIMITE_ATRASO * 86_400_000).toISOString();
  let aIniciar = 0, emAndamento = 0, atrasadas = 0, finalizadas = 0, totalBates = 0, pendTermo = 0, pendLastro = 0;
  const fundos = new Map<string, FundoPainel & { _ref: string }>();
  const resumos = await resumosDaAuditoria(ids);
  for (const b of comFundo) {
    const r = resumos.get(b.id);
    if (!r) continue;
    const lados = porLado.get(b.id) ?? { termo: 0, lastro: 0 };
    if (r.status === 'a_iniciar') aIniciar++;
    else if (r.status === 'finalizada') finalizadas++;
    else {
      emAndamento++;
      if (b.criado_em < limiteAtraso) atrasadas++;
    }
    totalBates += r.batidas;
    pendTermo += lados.termo;
    pendLastro += lados.lastro;
    const base: BasePainel = {
      base_id: b.id, nome: b.nome, data_referencia: b.data_referencia, criado_em: b.criado_em, status: r.status,
      total_bates: r.batidas, pend_termo: lados.termo, pend_lastro: lados.lastro, total_pendencias: lados.termo + lados.lastro,
      pre_bates: r.pre_bates, progresso: r.progresso, ultima_atividade: r.ultima_atividade,
    };
    const chave = b.cnpj || (b.nomeFundo ?? '').trim().toUpperCase() || 'SEM_FUNDO';
    let f = fundos.get(chave);
    if (!f) {
      fundos.set(chave, (f = {
        fundo_chave: chave, nome_fundo: b.nomeFundo, cnpj_fundo: b.cnpj, administradora: b.adm, total_bases: 0, auditorias_iniciadas: 0,
        total_bates: 0, pend_termo: 0, pend_lastro: 0, total_pendencias: 0, cobertura: 0, ultima_atividade: null, bases: [], _ref: '',
      }));
    }
    // Nome e CNPJ da base mais recente do fundo.
    if (b.criado_em > f._ref) {
      f._ref = b.criado_em;
      f.nome_fundo = b.nomeFundo ?? f.nome_fundo;
      f.administradora = b.adm ?? f.administradora;
    }
    f.total_bases++;
    if (r.status !== 'a_iniciar') f.auditorias_iniciadas++;
    f.total_bates += base.total_bates;
    f.pend_termo += base.pend_termo;
    f.pend_lastro += base.pend_lastro;
    f.total_pendencias += base.total_pendencias;
    if (base.ultima_atividade && (!f.ultima_atividade || base.ultima_atividade > f.ultima_atividade)) f.ultima_atividade = base.ultima_atividade;
    f.bases.push(base);
  }
  const listaFundos = [...fundos.values()].map(({ _ref, ...f }) => {
    void _ref;
    return {
      ...f,
      cobertura: pct(f.total_bates, f.total_bates + f.total_pendencias),
      bases: f.bases.sort((a, b) => (b.data_referencia ?? '').localeCompare(a.data_referencia ?? '') || b.criado_em.localeCompare(a.criado_em)),
    };
  }).sort((a, b) => b.total_pendencias - a.total_pendencias || b.total_bases - a.total_bases);

  const totalPend = pendTermo + pendLastro;
  const totalBases = aIniciar + emAndamento + finalizadas;
  return {
    periodo: { de, ate },
    administradora_id: filtro.administradoraId ?? null,
    atualizado_em: agora.toISOString(),
    resumo_executivo: {
      auditorias_a_iniciar: aIniciar,
      auditorias_em_andamento: emAndamento,
      auditorias_em_andamento_atrasadas: atrasadas,
      dias_limite_atraso: DIAS_LIMITE_ATRASO,
      auditorias_finalizadas: finalizadas,
      total_bases_disponiveis: totalBases,
      taxa_cobertura: pct(emAndamento + finalizadas, totalBases),
    },
    metricas_bates: { total_bates: totalBates, total_pendencias: totalPend, bates_hoje: batesHoje },
    concluido_vs_pendente: {
      concluido: { quantidade: totalBates, percentual: pct(totalBates, totalBates + totalPend) },
      pendente: { quantidade: totalPend, percentual: pct(totalPend, totalBates + totalPend) },
    },
    pendencias_por_tipo: {
      termo: { quantidade: pendTermo, percentual: pct(pendTermo, totalPend) },
      lastro: { quantidade: pendLastro, percentual: pct(pendLastro, totalPend) },
    },
    fundos: listaFundos,
  };
}
