'use client';

import { chamar } from '@/lib/cliente';
import type { PaginaSelecao } from '@/app/api/auditorias/selecao';
import type { StatusAuditoria } from '@/lib/auditoria';

/** Bates › Seleção de Auditoria (navegador). */

export type ConsultaSelecao = {
  busca: string;
  tipo: 'trimestre' | 'data';
  ano: string;
  trimestre: string;
  data: string;
  status: StatusAuditoria;
  pagina: number;
};

export const apiSelecao = {
  listar: (c: ConsultaSelecao) => {
    const p = new URLSearchParams({ tipo: c.tipo, status: c.status, pagina: String(c.pagina), por_pagina: '16' });
    if (c.busca.trim()) p.set('busca', c.busca.trim());
    if (c.ano) p.set('ano', c.ano);
    if (c.trimestre) p.set('trimestre', c.trimestre);
    if (c.data) p.set('data', c.data);
    return chamar<PaginaSelecao>(`/api/auditorias?${p}`);
  },
  excluir: (baseId: string) => chamar<{ ok: true }>(`/api/auditorias/${encodeURIComponent(baseId)}`, { method: 'DELETE' }),
};
