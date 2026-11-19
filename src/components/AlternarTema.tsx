'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { CHAVE_TEMA } from '@/lib/tema';

const EVENTO = 'lastro-tema';

function assinar(avisar: () => void) {
  // Outra aba trocou o tema: acompanha.
  const aoArmazenar = (e: StorageEvent) => {
    if (e.key !== CHAVE_TEMA) return;
    document.documentElement.classList.toggle('dark', e.newValue === 'escuro');
    avisar();
  };
  window.addEventListener(EVENTO, avisar);
  window.addEventListener('storage', aoArmazenar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener('storage', aoArmazenar);
  };
}

const escuroAgora = () => document.documentElement.classList.contains('dark');
const noServidor = () => false;

function aplicarTema(escuro: boolean) {
  document.documentElement.classList.toggle('dark', escuro);
  try {
    localStorage.setItem(CHAVE_TEMA, escuro ? 'escuro' : 'claro');
  } catch {
    // Navegador sem armazenamento: vale só até recarregar.
  }
  window.dispatchEvent(new Event(EVENTO));
}

/** Alterna entre claro (padrão, fundo branco) e escuro. `compacto`: só o ícone (menu lateral). */
export function AlternarTema({ compacto = false }: { compacto?: boolean }) {
  const escuro = useSyncExternalStore(assinar, escuroAgora, noServidor);
  const proximo = escuro ? 'claro' : 'escuro';
  if (compacto) {
    return (
      <button
        type="button"
        onClick={() => aplicarTema(!escuro)}
        className="grid size-9 place-items-center rounded-full border-[1.5px] border-slate-300 text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-200 dark:hover:text-white"
        title={`Mudar para o modo ${proximo}`}
        aria-label={`Mudar para o modo ${proximo}`}
      >
        {escuro ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => aplicarTema(!escuro)}
      className="lastro-botao lastro-botao-sm lastro-botao-secundario"
      title={`Mudar para o modo ${proximo}`}
      aria-label={`Mudar para o modo ${proximo}`}
    >
      {escuro ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      {escuro ? 'Claro' : 'Escuro'}
    </button>
  );
}
