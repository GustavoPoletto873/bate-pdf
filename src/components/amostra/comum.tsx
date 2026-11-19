'use client';

import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, FileSpreadsheet, Upload, X } from 'lucide-react';
import { cx } from '@/components/ui';
import { extensaoAceita } from '@/lib/amostra/arquivos';

/** Peças compartilhadas das abas da Amostra (componentes.jsx e estilos.js do Bate Lastro). */

export const ORDEM_GRUPOS = ['Maiores Cedentes - Recompras', 'Maiores Cedentes', 'Adquiridos no Tri', 'Vencidos no Tri', 'Pendências'];
export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const inteiro = (v: number | null | undefined) => Number(v || 0).toLocaleString('pt-BR');
export const tamanho = (bytes: number) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
export const DICA = 'text-xs text-slate-600 dark:text-slate-400';

export function Bloco({ titulo, children, className }: { titulo: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('space-y-3', className)}>
      <h3 className="lastro-rotulo text-slate-500 dark:text-slate-400">{titulo}</h3>
      {children}
    </section>
  );
}

export function Campo({ rotulo, children, id }: { rotulo: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800 dark:text-slate-200">{rotulo}</label>
      {children}
    </div>
  );
}

/** Área de arrastar/escolher arquivos CSV/XLSX. Devolve os aceitos e avisa os recusados. */
export function ZonaArquivos({ titulo, multiplo = false, onArquivos, onRecusados }: {
  titulo: string; multiplo?: boolean; onArquivos: (arquivos: File[]) => void; onRecusados?: (nomes: string[]) => void;
}) {
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const receber = (lista: FileList | null) => {
    const arquivos = Array.from(lista ?? []);
    const fora = arquivos.filter((f) => !extensaoAceita(f.name));
    const aceitos = arquivos.filter((f) => extensaoAceita(f.name));
    if (fora.length) onRecusados?.(fora.map((f) => f.name));
    if (aceitos.length) onArquivos(multiplo ? aceitos : aceitos.slice(0, 1));
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${titulo}: arraste ou clique para escolher`}
      onClick={() => entrada.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); receber(e.dataTransfer.files); }}
      className={cx(
        'flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
        arrastando ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-500/10'
          : 'border-slate-300 hover:border-slate-500 dark:border-slate-700 dark:hover:border-slate-500',
      )}
    >
      <Upload className="size-5 shrink-0 text-slate-500 dark:text-slate-400" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-slate-800 dark:text-slate-100">{titulo}</p>
        <p className={DICA}>Arraste ou clique para escolher · CSV ou XLSX{multiplo ? ' · aceita vários arquivos' : ''}</p>
      </div>
      <input
        ref={entrada}
        type="file"
        accept=".csv,.xlsx"
        multiple={multiplo}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { receber(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}

export function LinhaArquivo({ arquivo, alertas = [], onRemover, children }: { arquivo: File; alertas?: string[]; onRemover?: () => void; children?: ReactNode }) {
  return (
    <div className={cx('rounded-xl border px-3 py-2', alertas.length ? 'border-amber-400 dark:border-amber-500/50' : 'border-slate-200 dark:border-slate-700')}>
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="size-4 shrink-0 text-slate-500 dark:text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100" title={arquivo.name}>{arquivo.name}</span>
        <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{tamanho(arquivo.size)}</span>
        {onRemover && (
          <button type="button" onClick={onRemover} aria-label={`Remover ${arquivo.name}`} className="rounded-md p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400">
            <X className="size-4" />
          </button>
        )}
      </div>
      {alertas.map((a) => (
        <p key={a} className="mt-1 flex gap-1.5 pl-7 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a}
        </p>
      ))}
      {children}
    </div>
  );
}

/** Seletor em pílulas (Padrão | Planner, filtros). */
export function Opcoes<T extends string>({ rotulo, opcoes, valor, onChange, desabilitado }: {
  rotulo: string; opcoes: { valor: T; rotulo: ReactNode }[]; valor: T; onChange: (v: T) => void; desabilitado?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex flex-wrap gap-1 rounded-full border-[1.5px] border-slate-300 p-0.5 dark:border-slate-700">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          disabled={desabilitado}
          onClick={() => onChange(o.valor)}
          className={cx(
            'rounded-full px-3.5 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            valor === o.valor ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
          )}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export function Contagem({ contagem }: { contagem: Record<string, number> | null | undefined }) {
  const grupos = ORDEM_GRUPOS.filter((g) => contagem?.[g]);
  if (!grupos.length) return <span className="text-slate-500 dark:text-slate-400">nenhum título</span>;
  return <>{grupos.map((g) => `${g}: ${inteiro(contagem![g])}`).join(' · ')}</>;
}

/** Mensagem de retorno no topo da aba (no lugar dos toasts do Bate Lastro). */
export type Mensagem = { tipo: 'ok' | 'erro' | 'alerta' | 'info'; texto: string } | null;
