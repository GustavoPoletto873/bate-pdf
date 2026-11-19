'use client';

import { chamar } from '@/lib/cliente';
import type { Administradora, BasePainel, FundoPainel, Painel } from '@/lib/dashboard';

export type { Administradora, BasePainel, FundoPainel, Painel };

/** Chamada do Análise › Dashboard. */
export const dashboardApi = {
  painel: (filtro: { de?: string | null; ate?: string | null; administradoraId?: string | null }) => {
    const p = new URLSearchParams();
    if (filtro.de) p.set('de', filtro.de);
    if (filtro.ate) p.set('ate', filtro.ate);
    if (filtro.administradoraId) p.set('administradora_id', filtro.administradoraId);
    return chamar<Painel & { administradoras: Administradora[] }>(`/api/dashboard?${p}`);
  },
};
