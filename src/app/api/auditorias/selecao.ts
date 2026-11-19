import { db } from '@/lib/db';
import { resumoDaAuditoria, type StatusAuditoria } from '@/lib/auditoria';
import { obterBase } from '@/lib/repo';
import { digitos as soDigitos } from '@/lib/texto';
import { dataIsoValida, fimDoTrimestre, inicioDoTrimestre } from '@/lib/upload-base/datas';

/**
 * Bates › Seleção de Auditoria e o resumo da Home — porta de routes/get/auditorias_selection.py.
 * Busca (nome da base, nome do fundo, CNPJ ou id), período sobre bases.data_referencia e status
 * pelo resumoDaAuditoria (a iniciar / em andamento / finalizada).
 */

export type FiltroSelecao = {
  busca?: string | null;
  /** 'trimestre' (ano + trimestre) ou 'data' (data exata); só o ano = o ano inteiro. */
  tipo?: 'trimestre' | 'data' | null;
  ano?: string | null;
  trimestre?: string | null;
  data?: string | null;
  status?: StatusAuditoria | null;
  pagina?: number;
  por_pagina?: number;
};

export type CartaoAuditoria = {
  base_id: string;
  nome: string;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  fundo_id: number | null;
  data_referencia: string | null;
  modo_referencia: 'TRIMESTRE' | 'DATA_REFERENCIA';
  origem: 'resultados_matching' | 'amostra';
  criado_em: string;
  atualizado_em: string;
  status: StatusAuditoria;
  titulos: number;
  pendentes: { termo: number; lastro: number };
  batidos: number;
  pre_bates: number;
  pdfs: number;
  /** 0..1 */
  progresso: number;
  ultima_atividade: string | null;
};

export type ResumoStatus = { a_iniciar: number; em_andamento: number; finalizadas: number; total: number };

export type PaginaSelecao = {
  resumo: ResumoStatus;
  status: StatusAuditoria;
  itens: CartaoAuditoria[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
};

type LinhaBase = {
  id: string; nome: string; nome_fundo: string | null; cnpj_fundo: string | null; data_referencia: string | null;
  fundo_id: number | null; fundo_nome: string | null;
};

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Intervalo [início, fim] de data_referencia do filtro de período, ou null (todos os períodos). */
export function intervaloDoPeriodo(filtro: Pick<FiltroSelecao, 'tipo' | 'ano' | 'trimestre' | 'data'>): [string, string] | null {
  const ano = Number(filtro.ano);
  const temAno = Number.isInteger(ano) && ano >= 1900 && ano <= 2999;
  const tri = Number(filtro.trimestre);
  if (filtro.tipo === 'trimestre' && temAno && tri >= 1 && tri <= 4) return [inicioDoTrimestre(tri, ano), fimDoTrimestre(tri, ano)];
  if (filtro.tipo === 'data' && dataIsoValida(filtro.data)) return [filtro.data, filtro.data];
  if (temAno) return [`${ano}-01-01`, `${ano}-12-31`];
  return null;
}

/** A base casa com a busca? Nome da base, nome do fundo (da base ou do cadastro), id e CNPJ. */
function casaBusca(b: LinhaBase, busca: string): boolean {
  const termo = semAcento(busca.trim());
  if (!termo) return true;
  if ([b.nome, b.nome_fundo, b.fundo_nome].some((t) => t && semAcento(t).includes(termo))) return true;
  if (b.id.toLowerCase().includes(termo)) return true;
  // Só compara com o CNPJ quando o termo tem cara de CNPJ: senão "FIDC 2" casaria com quase todo CNPJ.
  if (/^[\d.\-/\s]+$/.test(busca.trim())) {
    const d = soDigitos(busca);
    if (d.length >= 2 && soDigitos(b.cnpj_fundo).includes(d)) return true;
  }
  return false;
}

/** Bases do filtro (busca e período), já com o resumo de auditoria de cada uma. */
export function cartoesDoFiltro(filtro: Pick<FiltroSelecao, 'busca' | 'tipo' | 'ano' | 'trimestre' | 'data'> = {}): CartaoAuditoria[] {
  const intervalo = intervaloDoPeriodo(filtro);
  const linhas = db().prepare(`SELECT b.id, b.nome, b.nome_fundo, b.cnpj_fundo, b.data_referencia, b.fundo_id, f.nome AS fundo_nome
    FROM bases b LEFT JOIN fundos f ON f.id = b.fundo_id`).all() as LinhaBase[];
  const cartoes: CartaoAuditoria[] = [];
  for (const l of linhas) {
    if (intervalo && !(l.data_referencia && l.data_referencia.slice(0, 10) >= intervalo[0] && l.data_referencia.slice(0, 10) <= intervalo[1])) continue;
    if (filtro.busca && !casaBusca(l, filtro.busca)) continue;
    const base = obterBase(l.id);
    const resumo = resumoDaAuditoria(l.id);
    if (!base || !resumo) continue;
    cartoes.push({
      base_id: base.id,
      nome: base.nome,
      nome_fundo: base.nome_fundo ?? l.fundo_nome,
      cnpj_fundo: base.cnpj_fundo,
      fundo_id: base.fundo_id,
      data_referencia: base.data_referencia,
      modo_referencia: base.modo_referencia,
      origem: base.origem,
      criado_em: base.criado_em,
      atualizado_em: base.atualizado_em,
      status: resumo.status,
      titulos: base.titulos,
      pendentes: base.pendentes,
      batidos: resumo.batidas,
      pre_bates: resumo.pre_bates,
      pdfs: base.pdfs.total,
      progresso: resumo.progresso,
      ultima_atividade: resumo.ultima_atividade,
    });
  }
  // Mexida mais recente primeiro (último bate/marcação; sem atividade, a última alteração da base).
  return cartoes.sort((a, b) => (b.ultima_atividade ?? b.atualizado_em).localeCompare(a.ultima_atividade ?? a.atualizado_em));
}

export function contarStatus(cartoes: CartaoAuditoria[]): ResumoStatus {
  const n = (s: StatusAuditoria) => cartoes.filter((c) => c.status === s).length;
  return { a_iniciar: n('a_iniciar'), em_andamento: n('em_andamento'), finalizadas: n('finalizada'), total: cartoes.length };
}

export function lerStatus(valor: unknown): StatusAuditoria | null {
  const v = String(valor ?? '').trim().toLowerCase();
  if (v === 'a_iniciar' || v === 'em_andamento') return v;
  if (v === 'finalizada' || v === 'finalizadas') return 'finalizada';
  return null;
}

export function listarAuditorias(filtro: FiltroSelecao = {}): PaginaSelecao {
  const cartoes = cartoesDoFiltro(filtro);
  const status = filtro.status ?? 'a_iniciar';
  const doStatus = cartoes.filter((c) => c.status === status);
  const porPagina = Math.min(100, Math.max(1, filtro.por_pagina ?? 16));
  const paginas = Math.max(1, Math.ceil(doStatus.length / porPagina));
  const pagina = Math.min(paginas, Math.max(1, filtro.pagina ?? 1));
  return {
    resumo: contarStatus(cartoes),
    status,
    itens: doStatus.slice((pagina - 1) * porPagina, pagina * porPagina),
    total: doStatus.length,
    pagina,
    por_pagina: porPagina,
    paginas,
  };
}

/** Resumo da Home: contagem por status e as bases em andamento mexidas por último. */
export function painelInicial(limite = 4): { resumo: ResumoStatus; em_andamento: CartaoAuditoria[] } {
  const cartoes = cartoesDoFiltro();
  return { resumo: contarStatus(cartoes), em_andamento: cartoes.filter((c) => c.status === 'em_andamento').slice(0, limite) };
}
