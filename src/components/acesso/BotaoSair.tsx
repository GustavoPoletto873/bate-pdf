'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Botao } from '@/components/ui';

/** Sai do Lastro: encerra esta sessão na conta e volta para a tela de entrar. */
export function BotaoSair() {
  const [saindo, setSaindo] = useState(false);
  return (
    <Botao
      disabled={saindo}
      onClick={async () => {
        setSaindo(true);
        await fetch('/api/auth/sair', { method: 'POST' }).catch(() => null);
        // Recarga completa: nada da sessão anterior fica na memória da página.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/entrar';
      }}
    >
      <LogOut className="size-4" /> {saindo ? 'Saindo…' : 'Sair'}
    </Botao>
  );
}
