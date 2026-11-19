'use client';

import { chamar, json } from '@/lib/cliente';
import type { Entrada, EntradaComOcorrencias, OcorrenciaFundo } from '@/lib/blacklist';

export type { Entrada, EntradaComOcorrencias, OcorrenciaFundo };

/** Chamadas da tela Gestão › BlackList. */
export const blacklistApi = {
  listar: () => chamar<{ items: EntradaComOcorrencias[] }>('/api/blacklist'),
  criar: (nome: string, documento: string) => chamar<Entrada>('/api/blacklist', json({ nome, documento })),
  criarLote: (itens: { nome: string; documento: string }[]) =>
    chamar<{ criados: Entrada[]; erros: { linha: number; nome: string; documento: string; erro: string }[] }>('/api/blacklist/lote', json({ itens })),
  remover: (id: number) => chamar<{ ok: true }>(`/api/blacklist/${id}`, { method: 'DELETE' }),
  historico: (id: number) => chamar<Entrada & { bases: OcorrenciaFundo[] }>(`/api/blacklist/${id}/historico`),
  reprocessar: () => chamar<{ ocorrencias: number }>('/api/blacklist/reprocessar', { method: 'POST' }),
};
