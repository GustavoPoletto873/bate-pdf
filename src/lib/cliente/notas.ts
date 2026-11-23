'use client';

import { chamar, json } from '@/lib/cliente';
import type { NotaFiscal } from '@/lib/notasFiscais';

export type { NotaFiscal };

export type FiltroTela = { status: '' | 'ativa' | 'cancelada' | 'erro'; base: string; chave: string };
export type RespostaNotas = {
  dados: NotaFiscal[];
  paginacao: { pagina: number; tamanho: number; total: number; paginas: number };
  resumo: { total: number; ativas: number; canceladas: number; erros: number };
  bases: { id: string; nome: string; chaves: number; consultadas: number }[];
  serpro_configurado: boolean;
};
export type ProgressoConsulta = { base_id: string; total: number; feitas: number; ativas: number; canceladas: number; erros: number; terminou: boolean; erro: string | null };

const parametros = (f: Partial<FiltroTela>, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.base?.trim()) p.set('base', f.base.trim());
  if (f.chave?.trim()) p.set('chave', f.chave.trim());
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
};

/** Chamadas da tela Análise › NF Status. */
export const notasApi = {
  listar: (f: FiltroTela, pagina: number) => chamar<RespostaNotas>(`/api/notas-fiscais?${parametros(f, { pagina })}`),
  urlExportar: (f: Partial<FiltroTela>) => `/api/notas-fiscais/exportar?${parametros(f)}`,
  urlXml: (id: number) => `/api/notas-fiscais/${id}/xml`,
  consultar: (baseId: string) => chamar<{ progresso: ProgressoConsulta }>('/api/notas-fiscais/consulta', json({ base_id: baseId })),
  progresso: (baseId: string) => chamar<{ progresso: ProgressoConsulta | null }>(`/api/notas-fiscais/consulta?base=${encodeURIComponent(baseId)}`),
};
