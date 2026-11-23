'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bot, ChartColumn, ChevronRight, CircleUser, Dices, FileSpreadsheet, FileText, FolderCog, House, Landmark, Layers,
  LayoutDashboard, ListChecks, Paperclip, Receipt, ShieldX, Table2, type LucideIcon,
} from 'lucide-react';
import { AlternarTema } from '@/components/AlternarTema';
import { LogoLastro } from '@/components/LogoLastro';
import { cx } from '@/components/ui';
import { ehGrupo, MENU, PERFIL, rotaAtiva, type GrupoMenu, type IconeMenu, type ItemMenu } from '@/lib/menu';

const ICONES: Record<IconeMenu, LucideIcon> = {
  home: House, gestao: FolderCog, analise: ChartColumn, bates: ListChecks, perfil: CircleUser,
  base: FileSpreadsheet, anexo: Paperclip, fundos: Landmark, ia: Bot, relatorios: FileText, amostra: Dices,
  blacklist: ShieldX, dashboard: LayoutDashboard, visualizar: Table2, lotes: Layers, nf: Receipt,
};

/** Bolinha do item: acesa = traço de tinta com sombra, como os botões do Lastro. */
function Icone({ icone, ativo }: { icone: IconeMenu; ativo: boolean }) {
  const I = ICONES[icone];
  return (
    <span
      className={cx(
        'grid size-10 place-items-center rounded-full border-2 transition-all',
        ativo
          ? 'border-slate-900 bg-white text-slate-900 shadow-[0_3px_0_var(--lastro-destaque)] dark:border-slate-200 dark:bg-slate-900 dark:text-slate-100'
          : 'border-transparent text-slate-600 group-hover:border-slate-300 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:border-slate-600 dark:group-hover:text-slate-100',
      )}
    >
      <I className="size-5" strokeWidth={2} />
    </span>
  );
}

function ItemRaiz({ item, caminho }: { item: ItemMenu; caminho: string }) {
  const ativo = rotaAtiva(item.href, caminho);
  return (
    <Link href={item.href} className="group flex flex-col items-center gap-1" aria-current={ativo ? 'page' : undefined}>
      <Icone icone={item.icone} ativo={ativo} />
      <span className={cx('text-[11px] leading-none', ativo ? 'font-extrabold' : 'font-semibold text-slate-600 dark:text-slate-400')}>{item.rotulo}</span>
    </Link>
  );
}

function Grupo({ grupo, caminho, aberto, onAlternar, onFechar }: {
  grupo: GrupoMenu; caminho: string; aberto: boolean; onAlternar: () => void; onFechar: () => void;
}) {
  const ativo = grupo.itens.some((i) => rotaAtiva(i.href, caminho));
  return (
    <div className="relative">
      <button type="button" onClick={onAlternar} className="group flex w-full flex-col items-center gap-1" aria-expanded={aberto} aria-haspopup="menu">
        <Icone icone={grupo.icone} ativo={ativo || aberto} />
        <span className={cx('flex items-center gap-0.5 text-[11px] leading-none', ativo ? 'font-extrabold' : 'font-semibold text-slate-600 dark:text-slate-400')}>
          {grupo.rotulo}
          <ChevronRight className={cx('size-3 transition-transform', aberto && 'rotate-90')} />
        </span>
      </button>
      {aberto && (
        <div role="menu" aria-label={grupo.rotulo} className="lastro-cartao absolute left-full top-1/2 z-50 ml-5 w-56 -translate-y-1/2 p-2">
          <p className="lastro-rotulo px-2 pb-1.5 pt-1">{grupo.rotulo}</p>
          {grupo.itens.map((i) => {
            const I = ICONES[i.icone];
            const itemAtivo = rotaAtiva(i.href, caminho);
            if (i.emBreve) {
              return (
                <span key={i.href} role="menuitem" aria-disabled="true" title="Ainda não trazida do Bate Lastro para a versão local" className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm text-slate-400 dark:text-slate-600">
                  <I className="size-4" /> {i.rotulo}
                  <span className="ml-auto rounded-full border border-dashed border-slate-300 px-1.5 text-[10px] dark:border-slate-700">em breve</span>
                </span>
              );
            }
            return (
              <Link
                key={i.href}
                href={i.href}
                role="menuitem"
                onClick={onFechar}
                className={cx(
                  'flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors',
                  itemAtivo ? 'bg-slate-900 font-bold text-white dark:bg-slate-200 dark:text-slate-900' : 'font-medium hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <I className="size-4" /> {i.rotulo}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Menu lateral fixo com as "pastas" do Bate Lastro. Gestão e Análise abrem um painel ao lado. */
export function MenuLateral() {
  const caminho = usePathname();
  const [aberto, setAberto] = useState<GrupoMenu['id'] | null>(null);
  const raiz = useRef<HTMLElement>(null);

  // Fecha o painel ao clicar fora ou com Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(null); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  // Telas de acesso (entrar, convite) ocupam a tela toda, sem o menu.
  if (caminho === '/entrar' || caminho === '/convite') return null;

  return (
    <nav
      ref={raiz}
      aria-label="Menu"
      className="fixed inset-y-0 left-0 z-40 flex w-[88px] flex-col items-center border-r border-slate-200 bg-white py-3 dark:border-slate-800 dark:bg-slate-950"
    >
      <Link href="/" className="group flex flex-col items-center gap-1" title="Lastro: Bate PDF, a contingência do Bate Lastro">
        <LogoLastro tamanho={38} />
        <span className="text-[13px] font-extrabold tracking-tight">Lastro</span>
      </Link>

      <div className="mt-7 flex flex-1 flex-col items-center gap-6">
        {MENU.map((e) =>
          ehGrupo(e) ? (
            <Grupo
              key={e.id}
              grupo={e}
              caminho={caminho}
              aberto={aberto === e.id}
              onAlternar={() => setAberto((a) => (a === e.id ? null : e.id))}
              onFechar={() => setAberto(null)}
            />
          ) : (
            <ItemRaiz key={e.href} item={e} caminho={caminho} />
          ),
        )}
      </div>

      <div className="flex flex-col items-center gap-4 border-t border-dashed border-slate-300 pt-4 dark:border-slate-700">
        <AlternarTema compacto />
        <ItemRaiz item={PERFIL} caminho={caminho} />
      </div>
    </nav>
  );
}
