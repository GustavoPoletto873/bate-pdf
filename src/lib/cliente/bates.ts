'use client';

import { chamar, json } from '@/lib/cliente';
import type { BaseResumo } from '@/lib/repo';
import type { PainelBates, PaginaPreBates, PendenciaAberta, LeituraOrfa } from '@/lib/bates/preMatches';
import type { ResultadoProcessamento, MotivoProcessar } from '@/lib/bates/processar';
import type { EstatisticasResultado, LinhaResultado } from '@/lib/bates/resultados';
import type { ResumoInsercao } from '@/lib/bates/inserirResultado';

/** Chamadas da Gestão de Bates, de Resultados e do Inserir Resultado. */

export type FiltroPreBatesTela = { tipo: 'todos' | 'termo' | 'lastro'; confiabilidade: number[]; pagina: number; tamanho?: number };
export type FiltroResultadosTela = { aba: 'todos' | 'termo' | 'lastro'; status: 'todos' | 'V' | 'P'; q: string; pagina: number; tamanho?: number };

export type RespostaResultados = {
  base: BaseResumo;
  estatisticas: EstatisticasResultado;
  linhas: LinhaResultado[];
  total: number;
  pagina: number;
  tamanho: number;
};

const parametros = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

export const apiBates = {
  painel: (baseId: string) => chamar<{ base: BaseResumo; painel: PainelBates }>(`/api/bases/${baseId}/bates`),
  podeProcessar: (baseId: string) => chamar<{ pode_processar: boolean; motivo: MotivoProcessar }>(`/api/bases/${baseId}/processar`),
  processar: (baseId: string) => chamar<ResultadoProcessamento>(`/api/bases/${baseId}/processar`, { method: 'POST' }),
  preBates: (baseId: string, f: FiltroPreBatesTela) =>
    chamar<PaginaPreBates>(`/api/bases/${baseId}/pre-matches?${parametros({ tipo: f.tipo, confiabilidade: f.confiabilidade.join(','), pagina: f.pagina, tamanho: f.tamanho })}`),
  confirmar: (baseId: string, ids: number[]) =>
    chamar<{ confirmados: number; descartados: number }>(`/api/bases/${baseId}/pre-matches`, json({ acao: 'confirmar', ids })),
  rejeitar: (baseId: string, ids: number[]) => chamar<{ rejeitados: number }>(`/api/bases/${baseId}/pre-matches`, json({ acao: 'rejeitar', ids })),
  orfas: (baseId: string) => chamar<{
    pendencias: PendenciaAberta[]; total_pendencias: { termo: number; lastro: number }; orfas: LeituraOrfa[]; total_orfas: number;
  }>(`/api/bases/${baseId}/orfas`),
  resultados: (baseId: string, f: FiltroResultadosTela) =>
    chamar<RespostaResultados>(`/api/bases/${baseId}/resultados?${parametros({ aba: f.aba, status: f.status, q: f.q.trim(), pagina: f.pagina, tamanho: f.tamanho })}`),
  finalizar: (baseId: string, finalizada: boolean) => chamar<{ base: BaseResumo }>(`/api/bases/${baseId}/finalizar`, json({ finalizada })),
  inserirResultado: (baseId: string, arquivo: File, simular: boolean) => {
    const form = new FormData();
    form.append('arquivo', arquivo);
    form.append('simular', simular ? '1' : '0');
    return chamar<ResumoInsercao>(`/api/bases/${baseId}/inserir-resultado`, { method: 'POST', body: form });
  },
  urlExportar: (baseId: string) => `/api/bases/${baseId}/exportar?formato=xlsx`,
  urlDocumentos: (baseId: string, escopo: 'vinculados' | 'todos') => `/api/bases/${baseId}/exportar-documentos?escopo=${escopo}`,
  urlPendencias: (baseId: string, layout: 1 | 2) => `/api/bases/${baseId}/exportar-pendencias?layout=${layout}`,
};
