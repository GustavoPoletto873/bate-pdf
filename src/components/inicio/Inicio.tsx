import Link from 'next/link';
import { ArrowRight, ChevronRight, FileSpreadsheet, Link2, Paperclip, ScanText } from 'lucide-react';
import { IconeRabisco } from '@/components/rabiscos';
import { cx } from '@/lib/cx';
import type { PainelInicio } from './painel';

/** As quatro tarefas são uma sequência real (registrar → anexar → ler → bater): numeradas e ligadas por setas. */
const PASSOS = [
  { titulo: 'Registrar a base', texto: 'Envie a planilha de direitos creditórios da operação.', rota: '/base', Icone: FileSpreadsheet },
  { titulo: 'Anexar documentos', texto: 'Associe termos de cessão e lastros à base registrada.', rota: '/anexo', Icone: Paperclip },
  { titulo: 'Acompanhar leituras', texto: 'Espere os documentos saírem da fila de leitura.', rota: '/lotes', Icone: ScanText },
  { titulo: 'Fazer os bates', texto: 'Vincule cada direito creditório ao seu documento.', rota: '/auditoria-selection', Icone: Link2 },
];

const SITUACOES = [
  { chave: 'a_iniciar', status: 'a_iniciar', rotulo: 'A iniciar', cor: 'bg-sky-500 dark:bg-sky-400' },
  { chave: 'em_andamento', status: 'em_andamento', rotulo: 'Em andamento', cor: 'bg-indigo-500 dark:bg-indigo-400' },
  { chave: 'finalizadas', status: 'finalizada', rotulo: 'Finalizadas', cor: 'bg-emerald-500 dark:bg-emerald-400' },
] as const;

const bates = (id: string) => `/pre-matches?base=${encodeURIComponent(id)}`;

function AnelProgresso({ valor }: { valor: number }) {
  const raio = 22;
  const circ = 2 * Math.PI * raio;
  const pct = Math.min(100, Math.max(0, valor * 100));
  return (
    <div className="relative size-14 shrink-0">
      <svg viewBox="0 0 56 56" className="size-14 -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={raio} fill="none" strokeWidth="5" className="stroke-slate-200 dark:stroke-slate-800" />
        <circle cx="28" cy="28" r={raio} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-slate-900 dark:stroke-slate-100"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-bold tabular-nums">{Math.round(pct)}%</span>
    </div>
  );
}

/** Home (PaginaInicial.jsx) com a cara do Lastro. */
export function Inicio({ painel }: { painel: PainelInicio }) {
  const { resumo, em_andamento: lista } = painel;
  const principal = lista[0];
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-6 pt-8">
      <section className="lastro-cartao relative overflow-hidden px-6 py-8 sm:px-10">
        <div className="pointer-events-none absolute -right-4 -top-2 hidden rotate-12 text-slate-900 md:block dark:text-slate-200" aria-hidden="true">
          <IconeRabisco tipo="pdf" tamanho={96} />
        </div>
        <div className="pointer-events-none absolute bottom-6 right-36 hidden -rotate-12 text-slate-900 md:block dark:text-slate-200" aria-hidden="true">
          <IconeRabisco tipo="v" tamanho={44} />
        </div>
        <p className="inline-flex rounded-full border-[1.5px] border-slate-300 px-3 py-1 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{painel.data}</p>
        <h1 className="mt-4 font-display text-4xl tracking-tight md:text-5xl">{painel.saudacao}!</h1>
        <p className="mt-3 max-w-xl font-serif text-lg text-slate-600 dark:text-slate-300">{painel.frase}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          {principal ? (
            <Link href={bates(principal.base_id)} className="lastro-btn lastro-btn-solido max-w-full">
              <IconeRabisco tipo="lupa" /> <span className="truncate">Continuar {principal.nome_fundo || principal.nome}</span>
            </Link>
          ) : (
            <Link href="/base" className="lastro-btn lastro-btn-solido"><IconeRabisco tipo="pdf" /> Registrar uma base</Link>
          )}
          {principal
            ? <Link href="/base" className="lastro-btn lastro-btn-contorno"><IconeRabisco tipo="pdf" /> Registrar nova base</Link>
            : <Link href="/cadastro-fundo" className="lastro-btn lastro-btn-contorno"><IconeRabisco tipo="moeda" /> Cadastrar fundos</Link>}
        </div>
      </section>

      <section aria-labelledby="continuar-titulo" className="lastro-cartao mt-8 p-6">
        <h2 id="continuar-titulo" className="font-display text-lg tracking-tight">{lista.length ? 'Continue de onde parou' : 'Suas auditorias'}</h2>
        {lista.length > 0 && <p className="mt-0.5 font-serif text-sm text-slate-600 dark:text-slate-400">Bases em andamento, da mexida mais recente para a mais antiga.</p>}
        {lista.length === 0 ? (
          <div className="mt-4 rounded-2xl border-2 border-dashed border-slate-300 px-5 py-6 text-center dark:border-slate-700">
            <p className="font-semibold">Nada para retomar por enquanto.</p>
            <p className="mx-auto mt-1 max-w-md font-serif text-sm text-slate-600 dark:text-slate-400">Assim que você começar os bates de uma base, ela aparece aqui para você continuar de onde parou.</p>
          </div>
        ) : (
          <ul className={cx('mt-4 grid gap-3', lista.length > 1 && 'lg:grid-cols-2')}>
            {lista.map((a) => {
              const pendentes = a.pendentes.termo + a.pendentes.lastro;
              return (
                <li key={a.base_id}>
                  <Link href={bates(a.base_id)} title="Abrir os bates"
                    className="group flex items-center gap-4 rounded-2xl border-2 border-slate-200 px-4 py-3.5 transition-colors hover:border-slate-900 dark:border-slate-800 dark:hover:border-slate-200">
                    <AnelProgresso valor={a.progresso} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.nome_fundo || 'Base sem fundo'}</p>
                      <p className="truncate text-sm text-slate-600 dark:text-slate-400">{pendentes ? `${pendentes} ${pendentes === 1 ? 'pendente' : 'pendentes'}` : 'Sem pendências'}</p>
                      <p className="truncate text-xs text-slate-400 dark:text-slate-500">{a.nome}</p>
                    </div>
                    {a.quando && <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400" title="Última atividade nesta base">{a.quando}</span>}
                    <ChevronRight className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {resumo.total > 0 && (
        <section aria-labelledby="situacao-titulo" className="lastro-cartao mt-8 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="situacao-titulo" className="font-display text-lg tracking-tight">Suas bases <span className="ml-2 font-sans text-sm font-normal text-slate-500 dark:text-slate-400">{resumo.total} no total</span></h2>
            <Link href="/home" className="text-sm font-semibold underline decoration-wavy decoration-indigo-500 underline-offset-4">Ver números no painel</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {SITUACOES.map((s) => {
              const n = resumo[s.chave];
              const fatia = resumo.total ? (n / resumo.total) * 100 : 0;
              return (
                <Link key={s.chave} href={`/auditoria-selection?status=${s.status}`}
                  className="group rounded-2xl border-2 border-slate-200 px-5 py-4 transition-colors hover:border-slate-900 dark:border-slate-800 dark:hover:border-slate-200">
                  <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className={cx('size-2 rounded-full', s.cor)} />{s.rotulo}</p>
                  <p className="mt-2 flex items-baseline justify-between">
                    <span className="font-display text-3xl tabular-nums">{n}</span>
                    <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">{Math.round(fatia)}%</span>
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                    <div className={cx('h-full rounded-full', s.cor)} style={{ width: `${fatia}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="passos-titulo" className="mt-12">
        <h2 id="passos-titulo" className="font-display text-2xl tracking-tight">Começar algo novo</h2>
        <p className="mt-1 font-serif text-sm text-slate-600 dark:text-slate-400">Uma auditoria nova passa por estas tarefas, nesta ordem.</p>
        <ol className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12">
          {PASSOS.map((p, i) => (
            <li key={p.rota} className="relative">
              <Link href={p.rota} className="lastro-cartao group flex h-full flex-col p-6 transition-transform hover:-translate-y-1">
                <div className="flex items-center justify-between">
                  <span className="grid size-12 place-items-center rounded-2xl border-2 border-slate-900 transition-colors group-hover:bg-slate-900 group-hover:text-white dark:border-slate-200 dark:group-hover:bg-slate-100 dark:group-hover:text-slate-900">
                    <p.Icone className="size-5" aria-hidden="true" />
                  </span>
                  <span className="grid size-7 -rotate-6 place-items-center rounded-full border-2 border-slate-900 font-display text-xs dark:border-slate-200" aria-hidden="true">{i + 1}</span>
                </div>
                <h3 className="mt-4 font-bold">{p.titulo}</h3>
                <p className="mt-1 font-serif text-sm leading-6 text-slate-600 dark:text-slate-400">{p.texto}</p>
              </Link>
              {i < PASSOS.length - 1 && (
                <span aria-hidden="true" className="absolute -right-[38px] top-1/2 z-10 hidden size-7 -translate-y-1/2 place-items-center rounded-full border-2 border-slate-900 bg-white lg:grid dark:border-slate-200 dark:bg-slate-950">
                  <ArrowRight className="size-3.5" />
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
