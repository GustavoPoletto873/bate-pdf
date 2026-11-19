'use client';

import dynamic from 'next/dynamic';

// Só no navegador: os filtros do dashboard ficam guardados neste computador (localStorage).
export const CarregarDashboard = dynamic(() => import('./TelaDashboard').then((m) => m.TelaDashboard), {
  ssr: false,
  loading: () => <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">Carregando o dashboard…</p>,
});
