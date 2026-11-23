'use client';

import { chamar, json } from '@/lib/cliente';
import type { Candidato, ResultadoTeste, TipoTreinado } from '@/lib/treino';
import type { CampoSpec, ConfigTipo } from '@/lib/ia/personalizados';

export type { Candidato, ResultadoTeste, TipoTreinado, CampoSpec, ConfigTipo };
export type ResumoTreino = {
  pendentes: number; separados: number; ignorados: number; treinados: number;
  grupos: { grupo: string; n: number }[];
  bases: { base_id: string; base_nome: string; n: number; pendentes: number }[];
};
export type AcaoDocumento = 'separar' | 'ignorar' | 'grupo' | 'desfazer' | 'treinados' | 'ler_de_novo';

function formulario(config: ConfigTipo, extra: { amostra?: File | null; documentoId?: number | null; tipoId?: number | null; versao?: number }): FormData {
  const f = new FormData();
  f.set('config', JSON.stringify(config));
  if (extra.amostra) f.set('amostra', extra.amostra);
  if (extra.documentoId) f.set('documento_id', String(extra.documentoId));
  if (extra.tipoId) f.set('tipo_id', String(extra.tipoId));
  if (extra.versao !== undefined) f.set('versao', String(extra.versao));
  return f;
}

/** Chamadas da tela Gestão › Treinar IA. */
export const treinoApi = {
  tipos: (busca = '') => chamar<{ itens: TipoTreinado[]; desativados: TipoTreinado[] }>(`/api/treino/tipos${busca ? `?busca=${encodeURIComponent(busca)}` : ''}`),
  testar: (config: ConfigTipo, origem: { amostra?: File | null; documentoId?: number | null; tipoId?: number | null }, signal?: AbortSignal) =>
    chamar<ResultadoTeste>('/api/treino/testar', { method: 'POST', body: formulario(config, origem), signal }),
  criar: (config: ConfigTipo, origem: { amostra?: File | null; documentoId?: number | null }) =>
    chamar<{ tipo: TipoTreinado }>('/api/treino/tipos', { method: 'POST', body: formulario(config, origem) }),
  atualizar: (id: number, config: ConfigTipo, versao: number, origem: { amostra?: File | null; documentoId?: number | null }) =>
    chamar<{ tipo: TipoTreinado }>(`/api/treino/tipos/${id}`, { method: 'PUT', body: formulario(config, { ...origem, versao }) }),
  desativar: (id: number) => chamar<null>(`/api/treino/tipos/${id}`, { method: 'DELETE' }),
  restaurar: (id: number) => chamar<{ tipo: TipoTreinado }>(`/api/treino/tipos/${id}/restaurar`, { method: 'POST' }),
  urlAmostra: (id: number) => `/api/treino/tipos/${id}/amostra`,
  documentos: (f: { base?: string; pendentes?: boolean; busca?: string; pagina?: number }) => {
    const p = new URLSearchParams();
    if (f.base) p.set('base', f.base);
    if (f.pendentes) p.set('pendentes', '1');
    if (f.busca?.trim()) p.set('busca', f.busca.trim());
    p.set('pagina', String(f.pagina ?? 1));
    return chamar<{ itens: Candidato[]; total: number; pagina: number; tamanho: number; resumo: ResumoTreino }>(`/api/treino/documentos?${p}`);
  },
  acao: (acao: AcaoDocumento, ids: number[], extra: { grupo?: string | null; tipo_documento_id?: number } = {}) =>
    chamar<{ alterados: number }>('/api/treino/documentos/acao', json({ acao, ids, ...extra })),
  urlPdf: (documentoId: number) => `/api/treino/documentos/${documentoId}/pdf`,
};
