'use client';

import { chamar, json } from '@/lib/cliente';
import type { BaseDoAnexo, DocumentoDoLote, Recusado } from '@/lib/anexo/lotes';
import type { Leitura } from '@/lib/leituras';
import type { StatusGemini } from '@/lib/ia/config';

/** Chamadas do Anexo (navegador). */

export type FundoAnexo = { id: number; nome: string; cnpj: string; bases: number };
export type EstadoLote = {
  lote: { id: string; base_id: string; agrupar_por_pasta: boolean; total_documentos: number; criado_em: string };
  documentos: DocumentoDoLote[];
  leituras: Leitura[];
  resumo: Record<string, number>;
};
export type StatusIa = StatusGemini & { uso: { chamadas: number; entrada: number; saida: number; custo: number } };

export type { BaseDoAnexo, DocumentoDoLote, Recusado };

export const apiAnexo = {
  statusIa: () => chamar<StatusIa>('/api/ia'),
  fundos: () => chamar<{ fundos: FundoAnexo[] }>('/api/anexo/fundos'),
  bases: (f: { id?: string; fundo_id?: number; data?: string; modo?: 'TRIMESTRE' | 'DATA_REFERENCIA' }) => {
    const p = new URLSearchParams();
    if (f.id) p.set('id', f.id);
    if (f.fundo_id) p.set('fundo_id', String(f.fundo_id));
    if (f.data) p.set('data', f.data);
    if (f.modo) p.set('modo', f.modo);
    return chamar<{ bases: BaseDoAnexo[] }>(`/api/anexo/bases?${p}`);
  },
  conteudoZip: (arquivo: File) => {
    const form = new FormData();
    form.append('arquivo', arquivo, arquivo.name);
    return chamar<{ caminhos: string[] }>('/api/anexo/zip', { method: 'POST', body: form });
  },
  criarLote: (baseId: string, agrupar: boolean) => chamar<{ id: string }>('/api/anexo/lotes', json({ base_id: baseId, agrupar })),
  enviarArquivos: (loteId: string, form: FormData) =>
    chamar<{ documentos: number; recusados: Recusado[] }>(`/api/anexo/lotes/${loteId}/arquivos`, { method: 'POST', body: form }),
  lote: (loteId: string) => chamar<EstadoLote>(`/api/anexo/lotes/${loteId}`),
  tentarDeNovo: (corpo: { documento_ids?: number[]; base_id?: string }) => chamar<{ reenfileirados: number }>('/api/anexo/tentar', json(corpo)),
  reaproveitar: (origem: string, destino: string) => chamar<{ copiadas: number }>('/api/anexo/reaproveitar', json({ origem, destino })),
};
