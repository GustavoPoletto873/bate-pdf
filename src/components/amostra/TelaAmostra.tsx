'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Dices, Layers, ShieldCheck } from 'lucide-react';
import { cx } from '@/components/ui';
import { Aviso } from '@/components/ui';
import { amostraApi, type FundoAmostra } from '@/lib/cliente/amostra';
import { trimestreAnterior } from '@/lib/amostra/arquivos';
import { NovaAmostra } from './NovaAmostra';
import { GerarEmLote } from './GerarEmLote';
import { ConferirSeed } from './ConferirSeed';

type Aba = 'nova' | 'lote' | 'conferir';
const ABAS: { id: Aba; titulo: string; icone: ReactNode }[] = [
  { id: 'nova', titulo: 'Nova amostra', icone: <Dices className="size-4" /> },
  { id: 'lote', titulo: 'Em lote', icone: <Layers className="size-4" /> },
  { id: 'conferir', titulo: 'Conferir seed', icone: <ShieldCheck className="size-4" /> },
];

/** Gestão › Amostra: as três abas ficam montadas (trocar de aba não perde o que foi preenchido). */
export function TelaAmostra() {
  const [aba, setAba] = useState<Aba>('nova');
  const [loteAberto, setLoteAberto] = useState(false);
  const [fundos, setFundos] = useState<FundoAmostra[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo] = useState(() => trimestreAnterior());

  useEffect(() => {
    let ativo = true;
    amostraApi.fundos()
      .then((r) => { if (ativo) setFundos(r.fundos); })
      .catch(() => { if (ativo) setErro('Não foi possível carregar os fundos. Confira se o Lastro está rodando e recarregue a página.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  const irPara = (id: Aba) => {
    setAba(id);
    if (id === 'lote') setLoteAberto(true);
  };

  return (
    <div className="space-y-6">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div role="tablist" aria-label="Amostra" className="flex w-fit max-w-full flex-wrap gap-1 rounded-full border-2 border-slate-900 p-1 dark:border-slate-200">
        {ABAS.map((a) => (
          <button key={a.id} id={`aba-${a.id}`} type="button" role="tab" aria-selected={aba === a.id} aria-controls={`painel-${a.id}`} onClick={() => irPara(a.id)}
            className={cx('flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
              aba === a.id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
            {a.icone}{a.titulo}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="painel-nova" aria-labelledby="aba-nova" hidden={aba !== 'nova'}>
        <NovaAmostra fundos={fundos} carregandoFundos={carregando} periodoPadrao={periodo} />
      </div>
      <div role="tabpanel" id="painel-lote" aria-labelledby="aba-lote" hidden={aba !== 'lote'}>
        {loteAberto && <GerarEmLote fundos={fundos} periodoPadrao={periodo} />}
      </div>
      <div role="tabpanel" id="painel-conferir" aria-labelledby="aba-conferir" hidden={aba !== 'conferir'}>
        <ConferirSeed />
      </div>
    </div>
  );
}
