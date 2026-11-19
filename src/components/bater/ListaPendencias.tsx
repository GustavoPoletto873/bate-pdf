'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { camposDoLado, type Lado } from '@/lib/campos';
import type { PendenciaLinha } from '@/lib/repo';
import type { SugestaoTitulo } from '@/lib/cliente';
import { formatarData, formatarMoeda } from '@/lib/valores';
import { cx } from '@/components/ui';
import { ROTULO_CONFIANCA } from '@/components/bater/preClassificacao';

const ALTURA_LINHA = 34;

/** Lista das pendências (uma linha por título × lado), renderizando só as linhas visíveis. */
export function ListaPendencias({ linhas, ativa, selecionadas, sugestoes, onAtivar, onAlternarSelecao, onSelecionarTodas }: {
  linhas: PendenciaLinha[];
  ativa: number | null;
  selecionadas: Set<number>;
  sugestoes: Record<number, SugestaoTitulo>;
  onAtivar: (id: number) => void;
  onAlternarSelecao: (id: number, comShift: boolean) => void;
  onSelecionarTodas: (marcar: boolean) => void;
}) {
  const rolagemRef = useRef<HTMLDivElement>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(600);

  useEffect(() => {
    const el = rolagemRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAltura(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mantém a linha ativa visível quando muda pelo teclado.
  useEffect(() => {
    const el = rolagemRef.current;
    const i = linhas.findIndex((l) => l.pendencia_id === ativa);
    if (!el || i < 0) return;
    const y = i * ALTURA_LINHA;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ALTURA_LINHA > el.scrollTop + el.clientHeight) el.scrollTop = y + ALTURA_LINHA - el.clientHeight;
  }, [ativa, linhas]);

  const inicio = Math.max(0, Math.floor(topo / ALTURA_LINHA) - 10);
  const fim = Math.min(linhas.length, Math.ceil((topo + altura) / ALTURA_LINHA) + 10);
  const todasMarcadas = linhas.length > 0 && linhas.every((l) => selecionadas.has(l.pendencia_id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid h-7 shrink-0 grid-cols-[28px_34px_minmax(90px,1.1fr)_minmax(120px,2fr)_96px_78px_58px] lastro-rotulo items-center gap-1 border-b text-[10px] tracking-[0.04em] border-slate-200 bg-slate-50 px-2 dark:border-slate-800 dark:bg-slate-900">
        <input type="checkbox" aria-label="Selecionar todas" checked={todasMarcadas} onChange={(e) => onSelecionarTodas(e.target.checked)} />
        <span>Lado</span><span>Nº doc.</span><span>Sacado</span><span className="text-right">Valor</span><span>Venc.</span><span className="text-center">Campos</span>
      </div>
      <div ref={rolagemRef} className="rolagem-fina relative min-h-0 flex-1 overflow-auto" onScroll={(e) => setTopo(e.currentTarget.scrollTop)}>
        <div style={{ height: linhas.length * ALTURA_LINHA }} />
        {linhas.slice(inicio, fim).map((l, k) => (
          <Linha
            key={l.pendencia_id}
            linha={l}
            topo={(inicio + k) * ALTURA_LINHA}
            ativa={l.pendencia_id === ativa}
            selecionada={selecionadas.has(l.pendencia_id)}
            sugestao={sugestoes[l.titulo_id]}
            onAtivar={onAtivar}
            onAlternarSelecao={onAlternarSelecao}
          />
        ))}
        {linhas.length === 0 && <p className="absolute inset-x-0 top-6 text-center font-serif text-sm text-slate-500">Nenhuma pendência com esse filtro.</p>}
      </div>
    </div>
  );
}

export function progressoDaLinha(l: PendenciaLinha) {
  const campos = camposDoLado(l.lado);
  const fonte = l.vinculo ? l.vinculo.marcacoes : Object.fromEntries(Object.entries(l.marcacoes).map(([k, m]) => [k, m!.valor]));
  let v = 0, d = 0, p = 0;
  for (const c of campos) {
    const m = fonte[c.campo as keyof typeof fonte];
    if (m === 'V') v++;
    else if (m === 'D') d++;
    else if (m === 'P') p++;
  }
  return { v, d, p, total: campos.length, decididos: v + d };
}

const Linha = memo(function Linha({ linha: l, topo, ativa, selecionada, sugestao, onAtivar, onAlternarSelecao }: {
  linha: PendenciaLinha;
  topo: number;
  ativa: boolean;
  selecionada: boolean;
  sugestao?: SugestaoTitulo;
  onAtivar: (id: number) => void;
  onAlternarSelecao: (id: number, comShift: boolean) => void;
}) {
  const prog = progressoDaLinha(l);
  const confianca = sugestao?.candidatos?.[l.lado as Lado] ? (sugestao.candidatos[l.lado]?.confianca as string) : sugestao ? 'sem_candidato' : null;
  return (
    <div
      role="row"
      onClick={() => onAtivar(l.pendencia_id)}
      className={cx(
        'absolute inset-x-0 grid cursor-pointer grid-cols-[28px_34px_minmax(90px,1.1fr)_minmax(120px,2fr)_96px_78px_58px] items-center gap-1 border-b border-slate-100 px-2 text-xs dark:border-slate-800/70',
        ativa ? 'bg-indigo-50 shadow-[inset_3px_0_0_var(--lastro-destaque)] dark:bg-indigo-500/15' : selecionada ? 'bg-sky-50/70 dark:bg-sky-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
      )}
      style={{ top: topo, height: ALTURA_LINHA }}
    >
      <input
        type="checkbox"
        checked={selecionada}
        onClick={(e) => { e.stopPropagation(); onAlternarSelecao(l.pendencia_id, e.shiftKey); }}
        onChange={() => {}}
        aria-label="Selecionar"
      />
      <span className={cx('w-fit rounded px-1 text-[10px] font-bold', l.lado === 'termo' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' : 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300')}>
        {l.lado === 'termo' ? 'T' : 'L'}
      </span>
      <span className="truncate font-mono" title={l.titulo.numero_documento ?? ''}>{l.titulo.numero_documento}</span>
      <span className="flex min-w-0 items-center gap-1">
        {confianca && <span className={cx('size-2 shrink-0 rounded-full', ROTULO_CONFIANCA[confianca]?.ponto ?? 'bg-slate-300')} title={`Pré-classificação: ${ROTULO_CONFIANCA[confianca]?.texto ?? confianca}`} />}
        {l.pre_bate && l.situacao === 'pendente' && <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" title="Tem pré-bate do Processar Base (confirme ou rejeite na Gestão de Bates)">PB</span>}
        <span className="truncate" title={l.titulo.sacado_nome ?? ''}>{l.titulo.sacado_nome}</span>
      </span>
      <span className="text-right tabular-nums">{formatarMoeda(l.titulo.valor_total)}</span>
      <span className="tabular-nums">{formatarData(l.titulo.data_vencimento)}</span>
      <span className="flex items-center justify-center gap-1">
        {l.situacao === 'vinculado'
          ? <CheckCircle2 className="size-4 text-emerald-600" aria-label="Batido" />
          : (
            <span className={cx('tabular-nums', prog.decididos === prog.total ? 'font-semibold text-emerald-700 dark:text-emerald-400' : prog.decididos ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400')}>
              {prog.decididos}/{prog.total}
            </span>
          )}
      </span>
    </div>
  );
});
