'use client';

import { chamar, json } from '@/lib/cliente';
import type { Administradora, DadosFundo, Fundo, PaginaFundos, ResultadoImportacaoFundos } from '@/lib/fundos';

/** Gestão › Fundos (navegador). */

export type FiltroFundosTela = { busca?: string; administradora?: string };

function consulta(filtro: FiltroFundosTela, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra);
  if (filtro.busca?.trim()) p.set('busca', filtro.busca.trim());
  if (filtro.administradora) p.set('administradora', filtro.administradora);
  return p.toString();
}

export const apiFundos = {
  listar: (filtro: FiltroFundosTela, pagina: number, porPagina = 20) =>
    chamar<PaginaFundos>(`/api/fundos?${consulta(filtro, { pagina: String(pagina), por_pagina: String(porPagina) })}`),
  /** Todos os fundos, por nome (para listas de escolha). */
  todos: () => chamar<PaginaFundos>('/api/fundos?todos=1').then((r) => r.itens),
  ids: (filtro: FiltroFundosTela) => chamar<{ ids: number[] }>(`/api/fundos/ids?${consulta(filtro)}`).then((r) => r.ids),
  obter: (id: number) => chamar<{ fundo: Fundo; uso: { bases: number; amostragens: number } }>(`/api/fundos/${id}`),
  criar: (dados: DadosFundo) => chamar<{ fundo: Fundo }>('/api/fundos', json(dados)).then((r) => r.fundo),
  atualizar: (id: number, dados: Partial<Omit<DadosFundo, 'cnpj'>>) => chamar<{ fundo: Fundo }>(`/api/fundos/${id}`, json(dados, 'PATCH')).then((r) => r.fundo),
  excluir: (id: number) => chamar<{ ok: true }>(`/api/fundos/${id}`, { method: 'DELETE' }),
  emLote: (ids: number[], dados: { administradora_id?: number | null; gestor?: string | null }) =>
    chamar<{ atualizados: number }>('/api/fundos/em-lote', json({ ids, ...dados }, 'PUT')).then((r) => r.atualizados),
  importar: (arquivo: File, simular: boolean) => {
    const form = new FormData();
    form.append('arquivo', arquivo);
    return chamar<ResultadoImportacaoFundos>(`/api/fundos/importar${simular ? '?simular=1' : ''}`, { method: 'POST', body: form });
  },
  urlModelo: '/api/fundos/modelo',
  administradoras: () => chamar<{ itens: Administradora[] }>('/api/administradoras').then((r) => r.itens),
  criarAdministradora: (nome: string) => chamar<{ administradora: Administradora }>('/api/administradoras', json({ nome })).then((r) => r.administradora),
};
