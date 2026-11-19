'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { BarChart3, Calendar, Clock, FileText, Play, Trash2 } from 'lucide-react';
import type { CartaoAuditoria as Cartao } from '@/app/api/auditorias/selecao';
import { formatarCpfCnpj } from '@/lib/texto';
import { rotuloReferencia } from '@/lib/upload-base/datas';
import { Botao, Etiqueta } from '@/components/ui';

const STATUS = {
  a_iniciar: { rotulo: 'A Iniciar', cor: 'sky' as const },
  em_andamento: { rotulo: 'Em Andamento', cor: 'indigo' as const },
  finalizada: { rotulo: 'Finalizada', cor: 'emerald' as const },
};

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const pararClique = (e: MouseEvent) => e.stopPropagation();

/** Cartão de uma base (AuditoriaCard): clicar abre os Bates. */
export function CartaoAuditoria({ a, onExcluir }: { a: Cartao; onExcluir: (a: Cartao) => void }) {
  const router = useRouter();
  const abrir = () => router.push(`/pre-matches?base=${encodeURIComponent(a.base_id)}`);
  const pct = Math.round(Math.min(1, Math.max(0, a.progresso)) * 100);
  const status = STATUS[a.status];
  return (
    <article
      role="link" tabIndex={0} aria-label={`Abrir os bates de ${a.nome}`}
      onClick={abrir}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) abrir(); }}
      className="lastro-cartao group flex cursor-pointer flex-col p-4 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-offset-4"
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Etiqueta cor={status.cor}>{status.rotulo}</Etiqueta>
        {a.data_referencia && <Etiqueta cor="amber">{rotuloReferencia(a.data_referencia, a.modo_referencia)}</Etiqueta>}
        {a.origem === 'resultados_matching' && <Etiqueta cor="violet" titulo="Base criada a partir do resultados_matching do Bate Lastro">contingência</Etiqueta>}
      </div>
      <h3 className="truncate text-base font-extrabold tracking-tight decoration-indigo-500 decoration-wavy decoration-2 underline-offset-[5px] group-hover:underline" title={a.nome_fundo ?? a.nome}>
        {a.nome_fundo || a.nome}
      </h3>
      <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{a.cnpj_fundo ? formatarCpfCnpj(a.cnpj_fundo) : 'sem CNPJ do fundo'}</p>
      <p className="mt-1 truncate text-sm text-slate-700 dark:text-slate-300" title={a.nome}>{a.nome}</p>

      <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        <p className="flex items-center gap-1.5"><Calendar className="size-3.5" /> Criada em {dia(a.criado_em)}</p>
        <p className="flex items-center gap-1.5"><Clock className="size-3.5" /> Atualizada em {dia(a.ultima_atividade ?? a.atualizado_em)}</p>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-1.5 text-center text-xs">
        {[
          ['títulos', a.titulos],
          ['pend. Termo', a.pendentes.termo],
          ['pend. Lastro', a.pendentes.lastro],
          ['batidos', a.batidos],
          ['pré-bates', a.pre_bates],
          ['PDFs', a.pdfs],
        ].map(([r, v]) => (
          <div key={r} className="rounded-lg bg-slate-50 px-1 py-1.5 dark:bg-slate-900">
            <dd className="font-display text-base tabular-nums">{v}</dd>
            <dt className="text-[10px] text-slate-500 dark:text-slate-400">{r}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-3">
        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400"><span>Progresso</span><span className="tabular-nums">{pct}%</span></div>
        <div className="mt-1 h-2 overflow-hidden rounded-full border border-slate-900 dark:border-slate-200">
          <div className="h-full bg-slate-900 dark:bg-slate-100" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-dashed border-slate-300 pt-3 dark:border-slate-700">
        <Link onClick={pararClique} href={`/pre-matches?base=${encodeURIComponent(a.base_id)}`} className="lastro-botao lastro-botao-sm lastro-botao-primario"><Play className="size-3.5" /> Bates</Link>
        <Link onClick={pararClique} href={`/results?base=${encodeURIComponent(a.base_id)}`} className="lastro-botao lastro-botao-sm lastro-botao-secundario"><BarChart3 className="size-3.5" /> Resultados</Link>
        <Link onClick={pararClique} href={`/bases/${encodeURIComponent(a.base_id)}`} className="lastro-botao lastro-botao-sm lastro-botao-secundario"><FileText className="size-3.5" /> Bater PDF</Link>
        <Botao tamanho="sm" variante="fantasma" className="ml-auto" title="Excluir base" aria-label={`Excluir a base ${a.nome}`}
          onClick={(e) => { e.stopPropagation(); onExcluir(a); }}>
          <Trash2 className="size-3.5" />
        </Botao>
      </div>
    </article>
  );
}
