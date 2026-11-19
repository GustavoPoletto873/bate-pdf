'use client';

import { chamar, json } from '@/lib/cliente';
import type { Acompanhamento, BaseEmAcompanhamento, DocumentoComErro } from '@/lib/anexo/acompanhamento';

/** Chamadas de Análise › Lotes (navegador). */

export type { Acompanhamento, BaseEmAcompanhamento, DocumentoComErro };

export const apiLotes = {
  acompanhamento: (pagina = 1, porPagina = 10) => chamar<Acompanhamento>(`/api/lotes?pagina=${pagina}&por_pagina=${porPagina}`),
  tentarDeNovo: (corpo: { documento_ids?: number[]; base_id?: string }) => chamar<{ reenfileirados: number }>('/api/anexo/tentar', json(corpo)),
};
