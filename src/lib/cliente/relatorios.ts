'use client';

import { chamar, json } from '@/lib/cliente';
import type { FundoParaEmissao, Rascunho, ResultadoLote, Trimestre, TipoRelatorio, Emitido } from '@/lib/relatorios/relatorios';

export type { FundoParaEmissao, Rascunho, ResultadoLote, Trimestre, TipoRelatorio, Emitido };
export type ItemHistorico = { id: string; tipo: string; nome_arquivo: string; criado_em: string; sem_pendencias: number; lote_id: string | null; data_base: string; fundo: string };

/** Chamadas da tela Gestão › Relatórios CVM/NIX. */
export const relatoriosApi = {
  listar: (dataBase: string | null, busca: string) => {
    const p = new URLSearchParams();
    if (dataBase) p.set('data_base', dataBase);
    if (busca.trim()) p.set('busca', busca.trim());
    return chamar<{ trimestres: Trimestre[]; data_base: string | null; fundos: FundoParaEmissao[]; historico: ItemHistorico[] }>(`/api/relatorios?${p}`);
  },
  coletar: (dataBase: string, forcar = false) => chamar<{ fundos: number; com_carteira: number; sem_carteira: number }>('/api/relatorios/coletar', json({ data_base: dataBase, forcar })),
  preparar: (fundoId: number, dataBase: string, antecipada: boolean, forcar = false) =>
    chamar<Rascunho>('/api/relatorios/rascunho', json({ fundo_id: fundoId, data_base: dataBase, antecipada, forcar })),
  rascunho: (id: string) => chamar<Rascunho>(`/api/relatorios/rascunho/${id}`),
  salvar: (id: string, escolhas: Record<string, string>, overrides: Record<string, string>) => chamar<Rascunho>(`/api/relatorios/rascunho/${id}`, json({ escolhas, overrides }, 'PATCH')),
  emitir: (id: string, tipos: TipoRelatorio[], opcoes: { confirmar_sem_base?: boolean; sem_pendencias?: boolean }) =>
    chamar<{ emitidos: Emitido[] }>(`/api/relatorios/rascunho/${id}/emitir`, json({ tipos, ...opcoes })),
  lote: (fundoIds: number[], dataBase: string, tipos: TipoRelatorio[], opcoes: { antecipada?: boolean; confirmar_sem_base?: boolean; sem_pendencias?: boolean }) =>
    chamar<ResultadoLote>('/api/relatorios/lote', json({ fundo_ids: fundoIds, data_base: dataBase, tipos, ...opcoes })),
  salvarAdministradora: (id: number, dados: { razao_social: string; endereco: string; endereco_complemento: string }) => chamar(`/api/administradoras/${id}`, json(dados, 'PATCH')),
  urlEmissao: (id: string) => `/api/relatorios/emissoes/${id}`,
  urlLote: (id: string) => `/api/relatorios/lote/${id}`,
};
