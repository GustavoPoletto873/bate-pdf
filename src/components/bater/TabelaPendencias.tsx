'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Search } from 'lucide-react';
import { CAMPOS, camposDoLado, type DefCampo, type Lado } from '@/lib/campos';
import type { PendenciaLinha } from '@/lib/repo';
import type { SugestaoTitulo } from '@/lib/cliente';
import { exibirValor } from '@/lib/exibir';
import { Selo, cx } from '@/components/ui';
import { ROTULO_CONFIANCA } from '@/components/bater/preClassificacao';

const ALTURA_LINHA = 34;

/** Colunas de valor da amostra mostradas na tabela (as de V/D/P são os 11 campos, como no Bate Lastro). */
const COLUNAS_VALOR: DefCampo[] = CAMPOS.filter((c) => ['numero_documento', 'sacado_nome', 'valor_total', 'data_vencimento'].includes(c.campo));

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

/**
 * "O que ainda falta resolver": a tabela de pendências do Bater PDF do Bate Lastro
 * (PendenciasPanel.jsx) — Tipo, os valores da amostra, um selo V/D/P por campo e a ação
 * "Buscar". Só as linhas visíveis vão para o DOM (bases com milhares de títulos).
 */
export function TabelaPendencias({ linhas, ativa, selecionadas, selecaoMultipla, sugestoes, onAtivar, onAlternarSelecao, onSelecionarTodas, onBuscar }: {
  linhas: PendenciaLinha[];
  ativa: number | null;
  selecionadas: Set<number>;
  selecaoMultipla: boolean;
  sugestoes: Record<number, SugestaoTitulo>;
  onAtivar: (id: number) => void;
  onAlternarSelecao: (id: number, comShift: boolean) => void;
  onSelecionarTodas: (marcar: boolean) => void;
  onBuscar: (linha: PendenciaLinha) => void;
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

  // Mantém a linha ativa visível quando muda pelo teclado (o cabeçalho fixo ocupa uma linha).
  useEffect(() => {
    const el = rolagemRef.current;
    const i = linhas.findIndex((l) => l.pendencia_id === ativa);
    if (!el || i < 0) return;
    const y = i * ALTURA_LINHA;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + 2 * ALTURA_LINHA > el.scrollTop + el.clientHeight) el.scrollTop = y + 2 * ALTURA_LINHA - el.clientHeight;
  }, [ativa, linhas]);

  const inicio = Math.max(0, Math.floor(topo / ALTURA_LINHA) - 10);
  const fim = Math.min(linhas.length, Math.ceil((topo + altura) / ALTURA_LINHA) + 10);
  const todasMarcadas = linhas.length > 0 && linhas.every((l) => selecionadas.has(l.pendencia_id));
  const totalColunas = (selecaoMultipla ? 1 : 0) + 1 + COLUNAS_VALOR.length + CAMPOS.length + 1;

  return (
    <div ref={rolagemRef} onScroll={(e) => setTopo(e.currentTarget.scrollTop)} className="rolagem-fina min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-black/20">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900">
          <tr className="text-[10px] uppercase text-slate-500 dark:text-slate-400" style={{ height: ALTURA_LINHA }}>
            {selecaoMultipla && (
              <th className="w-8 px-2">
                <input type="checkbox" aria-label="Selecionar todas do filtro" checked={todasMarcadas} onChange={(e) => onSelecionarTodas(e.target.checked)} />
              </th>
            )}
            <th className="whitespace-nowrap px-2 text-left">Tipo</th>
            <th className="whitespace-nowrap px-2 text-left">Ação</th>
            {COLUNAS_VALOR.map((c) => <th key={`v-${c.campo}`} className={cx('whitespace-nowrap px-2', c.tipo === 'moeda' ? 'text-right' : 'text-left')}>{c.rotulo}</th>)}
            {CAMPOS.map((c) => (
              <th key={`d-${c.campo}`} className="w-11 bg-indigo-50/70 px-0.5 text-center text-[9px] leading-tight dark:bg-indigo-500/10" title={c.rotulo}>{c.curto}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr><td colSpan={totalColunas} className="px-2 py-8 text-center font-serif text-sm text-slate-500">Nenhuma pendência encontrada</td></tr>
          ) : (
            <>
              {inicio > 0 && <tr aria-hidden="true"><td colSpan={totalColunas} style={{ height: inicio * ALTURA_LINHA, padding: 0 }} /></tr>}
              {linhas.slice(inicio, fim).map((l) => (
                <Linha
                  key={l.pendencia_id}
                  linha={l}
                  ativa={l.pendencia_id === ativa}
                  selecaoMultipla={selecaoMultipla}
                  selecionada={selecionadas.has(l.pendencia_id)}
                  sugestao={sugestoes[l.titulo_id]}
                  onAtivar={onAtivar}
                  onAlternarSelecao={onAlternarSelecao}
                  onBuscar={onBuscar}
                />
              ))}
              {fim < linhas.length && <tr aria-hidden="true"><td colSpan={totalColunas} style={{ height: (linhas.length - fim) * ALTURA_LINHA, padding: 0 }} /></tr>}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

const Linha = memo(function Linha({ linha: l, ativa, selecaoMultipla, selecionada, sugestao, onAtivar, onAlternarSelecao, onBuscar }: {
  linha: PendenciaLinha;
  ativa: boolean;
  selecaoMultipla: boolean;
  selecionada: boolean;
  sugestao?: SugestaoTitulo;
  onAtivar: (id: number) => void;
  onAlternarSelecao: (id: number, comShift: boolean) => void;
  onBuscar: (linha: PendenciaLinha) => void;
}) {
  const confianca = sugestao?.candidatos?.[l.lado as Lado] ? (sugestao.candidatos[l.lado]?.confianca as string) : sugestao ? 'sem_candidato' : null;
  const doLado = new Set(camposDoLado(l.lado).map((c) => c.campo));
  const batido = l.situacao !== 'pendente';
  const prog = progressoDaLinha(l);
  return (
    <tr
      onClick={(e) => (selecaoMultipla ? onAlternarSelecao(l.pendencia_id, e.shiftKey) : onAtivar(l.pendencia_id))}
      onDoubleClick={() => onAtivar(l.pendencia_id)}
      style={{ height: ALTURA_LINHA }}
      className={cx(
        'cursor-pointer border-b border-slate-100 dark:border-slate-800/70',
        ativa ? 'bg-indigo-50 shadow-[inset_3px_0_0_var(--lastro-destaque)] dark:bg-indigo-500/15'
          : selecionada ? 'bg-sky-50 dark:bg-sky-500/10'
            : batido ? 'bg-emerald-50/40 dark:bg-emerald-500/5' : 'hover:bg-white dark:hover:bg-slate-800/50',
      )}
    >
      {selecaoMultipla && (
        <td className="px-2" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selecionada} onChange={() => {}} onClick={(e) => onAlternarSelecao(l.pendencia_id, e.shiftKey)} aria-label="Selecionar" />
        </td>
      )}
      <td className="whitespace-nowrap px-2">
        <span className="flex items-center gap-1">
          <span className={cx('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', l.lado === 'termo'
            ? 'border-fuchsia-300/70 bg-fuchsia-100 text-fuchsia-700 dark:border-fuchsia-400/40 dark:bg-fuchsia-500/20 dark:text-fuchsia-200'
            : 'border-sky-300/70 bg-sky-100 text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-200')}>
            {l.lado === 'termo' ? 'Termo' : 'Lastro'}
          </span>
          {confianca && <span className={cx('size-2 shrink-0 rounded-full', ROTULO_CONFIANCA[confianca]?.ponto ?? 'bg-slate-300')} title={`Pré-classificação: ${ROTULO_CONFIANCA[confianca]?.texto ?? confianca}`} />}
          {l.pre_bate && !batido && <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" title="Tem pré-bate do Processar Base (confirme ou rejeite na Gestão de Bates)">PB</span>}
        </span>
      </td>
      <td className="whitespace-nowrap px-2">
        {batido ? (
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" /> {l.situacao === 'ja_batido' ? 'Já batido' : 'Batido'}</span>
        ) : (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAtivar(l.pendencia_id); onBuscar(l); }}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700"
              title="Procura o nº do documento em todos os PDFs da base"
            >
              <Search className="size-3" /> Buscar
            </button>
            <span className={cx('tabular-nums text-[11px]', prog.decididos === prog.total ? 'font-semibold text-emerald-700 dark:text-emerald-400' : prog.decididos ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400')} title="Campos decididos (V ou D)">
              {prog.decididos}/{prog.total}
            </span>
          </span>
        )}
      </td>
      {COLUNAS_VALOR.map((c) => {
        const v = exibirValor(c.campo, l.titulo[c.campoBase]);
        return (
          <td key={c.campo} className={cx('max-w-[180px] truncate whitespace-nowrap px-2', c.tipo === 'moeda' && 'text-right tabular-nums', c.campo === 'numero_documento' && 'font-mono', c.tipo === 'data' && 'tabular-nums')} title={v}>
            {v || <span className="text-slate-400">—</span>}
          </td>
        );
      })}
      {CAMPOS.map((c) => {
        if (!doLado.has(c.campo)) return <td key={c.campo} className="bg-indigo-50/30 text-center text-[9px] text-slate-400 dark:bg-indigo-500/5" title="Não se aplica ao Lastro">N/A</td>;
        const gravado = batido ? l.vinculo?.marcacoes[c.campo] : l.marcacoes[c.campo]?.valor;
        const sugerido = !gravado && !batido ? sugestao?.campos?.[c.campo]?.valor : undefined;
        return (
          <td key={c.campo} className="bg-indigo-50/30 text-center dark:bg-indigo-500/5">
            <Selo valor={gravado ?? sugerido} sugerido={Boolean(sugerido)} tamanho="sm" titulo={`${c.rotulo}: ${gravado ? `${gravado}${l.marcacoes[c.campo]?.valor_digitado ? ` (${l.marcacoes[c.campo]?.valor_digitado})` : ''}` : sugerido ? `sugerido ${sugerido}` : 'não decidido'}`} />
          </td>
        );
      })}
    </tr>
  );
});
