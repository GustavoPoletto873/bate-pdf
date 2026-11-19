'use client';

import { chamar } from '@/lib/cliente';
import type { FiltrosLeituras, LeituraVisualizar } from '@/lib/anexo/visualizar';

/** Chamadas de Análise › Visualizar (navegador). */

export type { FiltrosLeituras, LeituraVisualizar };

export type PaginaLeituras = { linhas: LeituraVisualizar[]; total: number; pagina: number; paginas: number; por_pagina: number };

export function parametros(filtros: FiltrosLeituras, extra: Record<string, string | number | undefined> = {}): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v && String(v).trim()) p.set(k, String(v).trim());
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p;
}

export const apiVisualizar = {
  leituras: (filtros: FiltrosLeituras, pagina: number, ordenar?: string, direcao?: 'asc' | 'desc') =>
    chamar<PaginaLeituras>(`/api/leituras?${parametros(filtros, { pagina, ordenar, direcao })}`),
  /** URL do Excel (o navegador baixa direto). */
  urlExportar: (filtros: FiltrosLeituras, colunas: string[], ordenar?: string, direcao?: 'asc' | 'desc') =>
    `/api/leituras/exportar?${parametros(filtros, { colunas: colunas.join(','), ordenar, direcao })}`,
};
