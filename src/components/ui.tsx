'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { VEREDITOS, type Veredito } from '@/lib/campos';

import { cx } from '@/lib/cx';

export { cx };

type Variante = 'primario' | 'secundario' | 'perigo' | 'fantasma' | 'sucesso';

/** Estilos em globals.css (.lastro-botao-*): pílula com traço de tinta, igual ao rodapé. */
export function Botao({
  variante = 'secundario', tamanho = 'md', className, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamanho?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx('lastro-botao', tamanho === 'sm' ? 'lastro-botao-sm' : 'lastro-botao-md', `lastro-botao-${variante}`, className)}
    >
      {children}
    </button>
  );
}

/** Selo V/D/P (mesmas cores do Excel de resultados). `sugerido` = tom apagado com contorno roxo. */
export function Selo({ valor, sugerido, titulo, onClick, tamanho = 'md' }: {
  valor: Veredito | null | undefined;
  sugerido?: boolean;
  titulo?: string;
  onClick?: () => void;
  tamanho?: 'sm' | 'md';
}) {
  const base = cx(
    'inline-grid place-items-center rounded border font-bold leading-none',
    tamanho === 'sm' ? 'size-5 text-[10px]' : 'size-6 text-xs',
  );
  const estilo = valor
    ? cx(VEREDITOS[valor].classe, sugerido && 'opacity-55 outline outline-2 outline-offset-1 outline-violet-500/70')
    : 'border-dashed border-slate-300 text-slate-400 dark:border-slate-600';
  const conteudo = valor ?? '·';
  const dica = titulo ?? (valor ? VEREDITOS[valor].titulo : 'Não decidido');
  if (!onClick) return <span className={cx(base, estilo)} title={dica}>{conteudo}</span>;
  return (
    <button type="button" onClick={onClick} title={dica} className={cx(base, estilo, 'cursor-pointer hover:brightness-95')}>
      {conteudo}
    </button>
  );
}

export function Etiqueta({ children, cor = 'slate', titulo }: { children: ReactNode; cor?: 'slate' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'violet' | 'sky' | 'orange'; titulo?: string }) {
  const cores: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    amber: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
    violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
    sky: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
    orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  };
  return (
    <span title={titulo} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', cores[cor])}>
      {children}
    </span>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok' | 'alerta'; children: ReactNode }) {
  const cores = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
    erro: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    alerta: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  };
  return <div className={cx('rounded-md border px-3 py-2 text-sm', cores[tipo])}>{children}</div>;
}

/** Diálogo modal simples. */
export function Dialogo({ aberto, titulo, children, rodape, onFechar, largura = 'max-w-lg' }: {
  aberto: boolean; titulo: string; children: ReactNode; rodape?: ReactNode; onFechar: () => void; largura?: string;
}) {
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 dark:bg-black/60" onMouseDown={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cx('lastro-cartao flex max-h-[90vh] w-full flex-col overflow-hidden', largura)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-dashed border-slate-300 px-5 py-3 dark:border-slate-700">
          <h2 className="font-display text-lg tracking-tight">{titulo}</h2>
          <button type="button" onClick={onFechar} className="grid size-7 place-items-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100" aria-label="Fechar">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex justify-end gap-2 border-t border-dashed border-slate-300 px-5 py-3 dark:border-slate-700">{rodape}</div>}
      </div>
    </div>
  );
}
