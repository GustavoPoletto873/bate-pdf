import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

/**
 * Esqueleto padrão das telas do Lastro (as "pastas" do menu): título carimbado, subtítulo em
 * serifa e as ações à direita. Use em toda tela nova para todas ficarem com a mesma cara.
 */
export function Pagina({ titulo, subtitulo, acoes, voltar, children, largura = 'max-w-6xl', className }: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acoes?: ReactNode;
  /** Link de volta acima do título (ex.: <Link href="/auditoria-selection">← Bates</Link>). */
  voltar?: ReactNode;
  children: ReactNode;
  /** Classe de largura máxima do conteúdo ('max-w-6xl' padrão; 'max-w-none' para telas cheias). */
  largura?: string;
  className?: string;
}) {
  return (
    <div className={cx('mx-auto w-full px-6 pb-10 pt-8', largura, className)}>
      {voltar && <div className="mb-2 text-sm text-slate-500 dark:text-slate-400">{voltar}</div>}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">{titulo}</h1>
          {subtitulo && <p className="mt-2 max-w-3xl font-serif text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </div>
  );
}

/** Cartão com título de seção (traço de tinta e sombra deslocada). */
export function Secao({ titulo, descricao, acoes, children, className }: {
  titulo?: ReactNode; descricao?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cx('lastro-cartao p-5', className)}>
      {(titulo || acoes) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {titulo && <h2 className="font-display text-lg tracking-tight">{titulo}</h2>}
            {descricao && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{descricao}</p>}
          </div>
          {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Número grande com rótulo (cartões de resumo do Dashboard, Lotes, Gestão de Bates…). */
export function Indicador({ rotulo, valor, detalhe, cor = 'tinta' }: {
  rotulo: ReactNode; valor: ReactNode; detalhe?: ReactNode; cor?: 'tinta' | 'verde' | 'ambar' | 'rosa' | 'indigo';
}) {
  const cores = {
    tinta: 'text-slate-900 dark:text-slate-100',
    verde: 'text-emerald-700 dark:text-emerald-400',
    ambar: 'text-amber-700 dark:text-amber-400',
    rosa: 'text-rose-700 dark:text-rose-400',
    indigo: 'text-indigo-700 dark:text-indigo-400',
  };
  return (
    <div className="lastro-cartao px-4 py-3">
      <p className="lastro-rotulo text-slate-500 dark:text-slate-400">{rotulo}</p>
      <p className={cx('mt-1 font-display text-3xl tabular-nums', cores[cor])}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detalhe}</p>}
    </div>
  );
}

/** Estado vazio com um rabisco (passe o ícone pronto, ex.: <IconeRabisco tipo="pdf" tamanho={44} />). */
export function Vazio({ icone, titulo, children }: { icone?: ReactNode; titulo: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      {icone && <div className="mx-auto mb-3 w-fit -rotate-6 text-slate-900 dark:text-slate-200">{icone}</div>}
      <p className="font-display text-lg">{titulo}</p>
      {children && <div className="mx-auto mt-1 max-w-xl font-serif text-sm text-slate-600 dark:text-slate-400">{children}</div>}
    </div>
  );
}
