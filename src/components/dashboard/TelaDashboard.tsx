'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Clock, Loader2, Play, Printer, Search, Target } from 'lucide-react';
import { Aviso, Botao, Etiqueta, cx } from '@/components/ui';
import { Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { formatarCpfCnpj } from '@/lib/texto';
import { ErroApi } from '@/lib/cliente';
import { dashboardApi, type Administradora, type FundoPainel, type Painel } from '@/lib/cliente/dashboard';

const inteiro = (v: number) => Number(v || 0).toLocaleString('pt-BR');
const pctTxt = (v: number) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const dataHora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// ---------------------------------------------------------------------------
// Filtros (guardados neste computador, como o useLocalStorageState do Bate Lastro)
// ---------------------------------------------------------------------------

type OpcaoPeriodo = { valor: string; rotulo: string; de: string | null; ate: string | null };

function opcoesDePeriodo(hoje = new Date()): OpcaoPeriodo[] {
  const ano = hoje.getFullYear();
  const fim = (t: number) => new Date(ano, t * 3, 0).getDate();
  const mm = (m: number) => String(m).padStart(2, '0');
  return [
    ...[1, 2, 3, 4].map((t) => ({ valor: `Q${t}`, rotulo: `${t}º Trimestre ${ano}`, de: `${ano}-${mm(t * 3 - 2)}-01`, ate: `${ano}-${mm(t * 3)}-${fim(t)}` })),
    { valor: 'DATA_REF', rotulo: 'Data de referência', de: null, ate: null },
    { valor: 'HISTORICO', rotulo: 'Histórico completo', de: null, ate: null },
    { valor: 'CUSTOM', rotulo: 'Personalizado', de: null, ate: null },
  ];
}
const trimestreAtual = (hoje = new Date()) => `Q${Math.floor(hoje.getMonth() / 3) + 1}`;

function lerGuardado(chave: string, padrao: string): string {
  try {
    return window.localStorage.getItem(chave) ?? padrao;
  } catch {
    return padrao;
  }
}
function guardar(chave: string, valor: string) {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* navegação privada: só não lembra */
  }
}

function useGuardado(chave: string, padrao: string): [string, (v: string) => void] {
  const [valor, setValor] = useState(() => lerGuardado(chave, padrao));
  return [valor, (v: string) => { setValor(v); guardar(chave, v); }];
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Cartao({ titulo, valor, detalhe, alerta, nota, icone, cor }: {
  titulo: string; valor: string; detalhe?: string; alerta?: string | null; nota?: string; icone: ReactNode; cor: string;
}) {
  return (
    <div className="lastro-cartao break-inside-avoid p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="lastro-rotulo text-slate-500 dark:text-slate-400">{titulo}</h3>
        <span className={cor}>{icone}</span>
      </div>
      <p className={cx('font-display text-3xl tabular-nums', cor)}>{valor}</p>
      {detalhe && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{detalhe}</p>}
      {nota && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{nota}</p>}
      {alerta && <p className="mt-1 flex items-center gap-1 text-sm font-medium text-orange-600 dark:text-orange-400"><AlertTriangle className="size-4" />{alerta}</p>}
    </div>
  );
}

/** Barra horizontal simples em CSS (sem biblioteca de gráfico). */
function Barra({ partes, altura = 'h-5' }: { partes: { valor: number; classe: string; titulo: string }[]; altura?: string }) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  return (
    <div className={cx('flex w-full overflow-hidden rounded-full border-[1.5px] border-[var(--lastro-tinta)] bg-[var(--lastro-realce)] print:border-slate-900', altura)}>
      {total > 0 && partes.map((p) => (
        <div key={p.titulo} className={cx('h-full', p.classe)} style={{ width: `${(p.valor / total) * 100}%` }} title={p.titulo} />
      ))}
    </div>
  );
}

function PainelConcluido({ painel }: { painel: Painel }) {
  const { concluido, pendente } = painel.concluido_vs_pendente;
  const { termo, lastro } = painel.pendencias_por_tipo;
  return (
    <section className="lastro-cartao break-inside-avoid space-y-5 p-6">
      <h2 className="font-display text-lg tracking-tight">Concluído vs. pendente no período</h2>
      <Barra partes={[
        { valor: concluido.quantidade, classe: 'bg-emerald-500 dark:bg-emerald-400 print:bg-emerald-500', titulo: `Concluído: ${pctTxt(concluido.percentual)}` },
        { valor: pendente.quantidade, classe: 'bg-rose-500 dark:bg-rose-400 print:bg-rose-500', titulo: `Pendente: ${pctTxt(pendente.percentual)}` },
      ]} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <CheckCircle2 className="size-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div><p className="font-display text-2xl tabular-nums">{inteiro(concluido.quantidade)}</p><p className="text-sm text-slate-600 dark:text-slate-400">Concluído ({pctTxt(concluido.percentual)}) — bates</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <Clock className="size-8 shrink-0 text-rose-600 dark:text-rose-400" />
          <div><p className="font-display text-2xl tabular-nums">{inteiro(pendente.quantidade)}</p><p className="text-sm text-slate-600 dark:text-slate-400">Pendente ({pctTxt(pendente.percentual)})</p></div>
        </div>
      </div>
      <div>
        <h3 className="lastro-rotulo mb-3 text-slate-500 dark:text-slate-400">Pendências por tipo</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([['Termo', termo, 'bg-violet-500 dark:bg-violet-400 print:bg-violet-500', 'text-violet-700 dark:text-violet-300'], ['Lastro', lastro, 'bg-teal-500 dark:bg-teal-400 print:bg-teal-500', 'text-teal-700 dark:text-teal-300']] as const).map(([rotulo, d, barra, texto]) => (
            <div key={rotulo} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-medium">{rotulo}</span><span className="text-sm text-slate-500 dark:text-slate-400">{pctTxt(d.percentual)}</span></div>
              <p className={cx('mb-2 font-display text-xl tabular-nums', texto)}>{inteiro(d.quantidade)}</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--lastro-realce)]"><div className={cx('h-full', barra)} style={{ width: `${Math.max(0, d.percentual)}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const STATUS: Record<string, { rotulo: string; cor: 'slate' | 'amber' | 'emerald' }> = {
  a_iniciar: { rotulo: 'A iniciar', cor: 'slate' },
  em_andamento: { rotulo: 'Em andamento', cor: 'amber' },
  finalizada: { rotulo: 'Finalizada', cor: 'emerald' },
};

type Ordem = 'nome_fundo' | 'total_bases' | 'auditorias_iniciadas' | 'total_bates' | 'pend_termo' | 'pend_lastro' | 'cobertura' | 'total_pendencias';
const COLUNAS: { campo: Ordem; rotulo: string }[] = [
  { campo: 'nome_fundo', rotulo: 'Fundo' }, { campo: 'total_bases', rotulo: 'Bases' }, { campo: 'auditorias_iniciadas', rotulo: 'Iniciadas' },
  { campo: 'total_bates', rotulo: 'Bates' }, { campo: 'pend_termo', rotulo: 'Pend. termo' }, { campo: 'pend_lastro', rotulo: 'Pend. lastro' },
  { campo: 'cobertura', rotulo: '% cobertura' },
];

function TabelaFundos({ fundos }: { fundos: FundoPainel[] }) {
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('total_pendencias');
  const [direcao, setDirecao] = useState<'asc' | 'desc'>('desc');
  const [aberto, setAberto] = useState<string | null>(null);
  const [visao, setVisao] = useState<'tabela' | 'grafico'>('tabela');

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const d = termo.replace(/\D/g, '');
    const filtrados = fundos.filter((f) => !termo || (f.nome_fundo ?? '').toLowerCase().includes(termo) || (!!d && (f.cnpj_fundo ?? '').includes(d)));
    return [...filtrados].sort((a, b) => {
      const va = a[ordem] ?? '', vb = b[ordem] ?? '';
      const r = typeof va === 'string' ? va.localeCompare(String(vb), 'pt-BR') : (va as number) - (vb as number);
      return direcao === 'asc' ? r : -r;
    });
  }, [fundos, busca, ordem, direcao]);
  const ordenar = (c: Ordem) => {
    if (c === ordem) setDirecao(direcao === 'asc' ? 'desc' : 'asc');
    else { setOrdem(c); setDirecao(c === 'nome_fundo' ? 'asc' : 'desc'); }
  };
  const maior = Math.max(1, ...lista.map((f) => f.total_bates + f.total_pendencias));

  return (
    <section className="lastro-cartao p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg tracking-tight">Por fundo</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{lista.length} {lista.length === 1 ? 'fundo' : 'fundos'} · bates e pendências agrupados pelo CNPJ do fundo (sem CNPJ, pelo nome)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do fundo ou CNPJ…" aria-label="Buscar fundo" className="lastro-campo h-9 w-60 pl-9 pr-3 text-sm" />
          </div>
          <div className="inline-flex rounded-full border-[1.5px] border-slate-300 p-0.5 dark:border-slate-700">
            {(['tabela', 'grafico'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setVisao(v)} aria-pressed={visao === v}
                className={cx('rounded-full px-3 py-1 text-sm font-medium', visao === v ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 dark:text-slate-400')}>
                {v === 'tabela' ? 'Tabela' : 'Barras'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!lista.length ? (
        <Vazio icone={<IconeRabisco tipo="lupa" tamanho={40} />} titulo="Nenhum fundo no período">Troque o período ou a administradora, ou suba uma base em Gestão › Upload Base.</Vazio>
      ) : visao === 'grafico' ? (
        <div className="space-y-2.5">
          <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-emerald-500" /> Bates</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-violet-500" /> Pend. termo</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-teal-500" /> Pend. lastro</span>
          </div>
          {lista.map((f) => {
            const total = f.total_bates + f.total_pendencias;
            return (
              <div key={f.fundo_chave} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate" title={f.nome_fundo ?? ''}>{f.nome_fundo ?? '—'}</span>
                <div style={{ width: `${Math.max(2, (total / maior) * 100)}%` }}>
                  <Barra altura="h-4" partes={[
                    { valor: f.total_bates, classe: 'bg-emerald-500', titulo: `Bates: ${inteiro(f.total_bates)}` },
                    { valor: f.pend_termo, classe: 'bg-violet-500', titulo: `Pend. termo: ${inteiro(f.pend_termo)}` },
                    { valor: f.pend_lastro, classe: 'bg-teal-500', titulo: `Pend. lastro: ${inteiro(f.pend_lastro)}` },
                  ]} />
                </div>
                <span className="tabular-nums text-slate-600 dark:text-slate-400">{pctTxt(f.cobertura)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-900 text-left dark:border-slate-200">
                {COLUNAS.map((c) => (
                  <th key={c.campo} className={cx('px-3 py-2.5', c.campo !== 'nome_fundo' && 'text-right')}>
                    <button type="button" onClick={() => ordenar(c.campo)} className="lastro-rotulo inline-flex items-center gap-1 hover:text-indigo-700 dark:hover:text-indigo-300">
                      {c.rotulo}{ordem === c.campo && (direcao === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                    </button>
                  </th>
                ))}
                <th className="lastro-rotulo px-3 py-2.5 text-left">Última atividade</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const expandido = aberto === f.fundo_chave;
                return (
                  <Fragment key={f.fundo_chave}>
                    <tr onClick={() => setAberto(expandido ? null : f.fundo_chave)} className={cx('cursor-pointer break-inside-avoid border-b border-slate-100 dark:border-slate-800', expandido ? 'bg-slate-50 dark:bg-slate-800/60' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40')}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <ChevronDown className={cx('size-4 shrink-0 transition-transform print:hidden', !expandido && '-rotate-90 text-slate-400')} />
                          <div>
                            <div className="font-medium">{f.nome_fundo ?? '—'}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{f.cnpj_fundo ? formatarCpfCnpj(f.cnpj_fundo) : 'sem CNPJ'}{f.administradora ? ` · ${f.administradora}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{inteiro(f.total_bases)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{inteiro(f.auditorias_iniciadas)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{inteiro(f.total_bates)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-violet-700 dark:text-violet-300">{inteiro(f.pend_termo)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-teal-700 dark:text-teal-300">{inteiro(f.pend_lastro)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pctTxt(f.cobertura)}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400">{dataHora(f.ultima_atividade)}</td>
                    </tr>
                    {expandido && (
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td colSpan={8} className="p-0">
                          <div className="border-l-4 border-indigo-400 px-6 py-3 dark:border-indigo-500/60">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                                  {['Base', 'Data de referência', 'Status', 'Bates', 'Pendências', 'Progresso', 'Atualização', ''].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {f.bases.map((b) => (
                                  <tr key={b.base_id} className="border-t border-slate-100 dark:border-slate-800">
                                    <td className="px-2 py-1.5">{b.nome}</td>
                                    <td className="px-2 py-1.5">{dataBr(b.data_referencia)}</td>
                                    <td className="px-2 py-1.5"><Etiqueta cor={STATUS[b.status].cor}>{STATUS[b.status].rotulo}</Etiqueta></td>
                                    <td className="px-2 py-1.5 tabular-nums text-emerald-700 dark:text-emerald-400">{inteiro(b.total_bates)}</td>
                                    <td className="px-2 py-1.5 tabular-nums text-rose-700 dark:text-rose-400">{inteiro(b.total_pendencias)} <span className="text-xs text-slate-500">(T {inteiro(b.pend_termo)} · L {inteiro(b.pend_lastro)})</span></td>
                                    <td className="w-32 px-2 py-1.5"><Barra altura="h-2.5" partes={[{ valor: b.progresso, classe: 'bg-emerald-500', titulo: pctTxt(b.progresso * 100) }, { valor: 1 - b.progresso, classe: 'bg-transparent', titulo: '' }]} /></td>
                                    <td className="px-2 py-1.5 text-xs text-slate-600 dark:text-slate-400">{dataHora(b.ultima_atividade)}</td>
                                    <td className="px-2 py-1.5 text-right print:hidden">
                                      <Link href={`/pre-matches?base=${encodeURIComponent(b.base_id)}`} onClick={(e) => e.stopPropagation()} title="Ir para a Gestão de Bates desta base"
                                        className="lastro-botao lastro-botao-sm lastro-botao-secundario"><Play className="size-3.5" /> Abrir</Link>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

/** Análise › Dashboard (HomeNew.jsx do Bate Lastro). Renderizada só no navegador (filtros guardados aqui). */
export function TelaDashboard() {
  const opcoes = useMemo(() => opcoesDePeriodo(), []);
  const [periodoGuardado, setPeriodo] = useGuardado('dashboardAuditoriaPeriodo', trimestreAtual());
  const [dataRef, setDataRef] = useGuardado('dashboardAuditoriaDataReferencia', '');
  const [inicio, setInicio] = useGuardado('dashboardAuditoriaPeriodoCustomStart', '');
  const [fim, setFim] = useGuardado('dashboardAuditoriaPeriodoCustomEnd', '');
  const [administradoraId, setAdministradoraId] = useGuardado('dashboardTrimestralAdministradorId', '');
  const periodo = opcoes.some((o) => o.valor === periodoGuardado) ? periodoGuardado : trimestreAtual();
  const opcao = opcoes.find((o) => o.valor === periodo)!;

  const intervaloInvalido = periodo === 'CUSTOM' && !!inicio && !!fim && fim < inicio;
  const aguardando = (periodo === 'CUSTOM' && (!inicio || !fim || intervaloInvalido)) || (periodo === 'DATA_REF' && !dataRef);
  const de = periodo === 'CUSTOM' ? inicio : periodo === 'DATA_REF' ? dataRef : opcao.de;
  const ate = periodo === 'CUSTOM' ? fim : periodo === 'DATA_REF' ? dataRef : opcao.ate;
  const chave = aguardando ? '' : `${de ?? ''}|${ate ?? ''}|${administradoraId}`;

  const [dados, setDados] = useState<{ chave: string; painel: Painel; administradoras: Administradora[] } | null>(null);
  const [erro, setErro] = useState<{ chave: string; texto: string } | null>(null);
  const [administradoras, setAdministradoras] = useState<Administradora[]>([]);

  useEffect(() => {
    if (!chave) return;
    let ativo = true;
    dashboardApi.painel({ de, ate, administradoraId })
      .then(({ administradoras: adms, ...painel }) => {
        if (!ativo) return;
        setDados({ chave, painel, administradoras: adms });
        setAdministradoras(adms);
        setErro(null);
      })
      .catch((e) => { if (ativo) setErro({ chave, texto: e instanceof ErroApi ? e.message : 'Não foi possível carregar o dashboard. Confira se o Lastro está rodando.' }); });
    return () => { ativo = false; };
  }, [chave, de, ate, administradoraId]);

  const carregando = !!chave && dados?.chave !== chave && erro?.chave !== chave;
  const painel = dados?.painel ?? null;
  const resumo = painel?.resumo_executivo;
  const bates = painel?.metricas_bates;
  const nomeAdm = administradoras.find((a) => String(a.id) === administradoraId)?.nome;
  const descricaoPeriodo = periodo === 'CUSTOM' ? (inicio && fim ? `Personalizado (${dataBr(inicio)} até ${dataBr(fim)})` : 'Personalizado')
    : periodo === 'DATA_REF' ? (dataRef ? `Data de referência ${dataBr(dataRef)}` : 'Data de referência') : opcao.rotulo;

  return (
    <div className="space-y-6">
      {/* Impressão: sem o menu lateral e sem os controles. */}
      <style>{`@media print { nav { display: none !important; } body { padding-left: 0 !important; background: #fff !important; } .lastro-cartao { box-shadow: none !important; } @page { margin: 12mm; } }`}</style>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-serif text-[15px] text-slate-700 dark:text-slate-300">
          {descricaoPeriodo}{nomeAdm ? ` · Administradora: ${nomeAdm}` : ''}
          {painel && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">atualizado em {dataHora(painel.atualizado_em)}</span>}
          {carregando && <span className="ml-2 inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 print:hidden"><Loader2 className="size-3 animate-spin" /> atualizando…</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período" className="lastro-campo h-9 px-3 text-sm">
            {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
          {periodo === 'DATA_REF' && <input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} aria-label="Data de referência" className="lastro-campo h-9 px-3 text-sm" />}
          {periodo === 'CUSTOM' && (
            <>
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} aria-label="Data inicial" className="lastro-campo h-9 px-3 text-sm" />
              <span className="text-sm text-slate-500">até</span>
              <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} aria-label="Data final" className="lastro-campo h-9 px-3 text-sm" />
            </>
          )}
          <select value={administradoraId} onChange={(e) => setAdministradoraId(e.target.value)} aria-label="Administradora" className="lastro-campo h-9 max-w-[16rem] px-3 text-sm">
            <option value="">Todas as administradoras</option>
            {administradoras.map((a) => <option key={a.id} value={String(a.id)}>{a.nome}</option>)}
          </select>
          <Botao onClick={() => window.print()} disabled={!painel}><Printer className="size-4" /> Imprimir</Botao>
        </div>
      </div>

      {intervaloInvalido && <Aviso tipo="erro">A data final não pode ser anterior à data inicial.</Aviso>}
      {aguardando && !intervaloInvalido && <Aviso tipo="info">{periodo === 'DATA_REF' ? 'Escolha a data de referência das bases.' : 'Escolha as duas datas do período personalizado.'}</Aviso>}
      {erro?.chave === chave && <Aviso tipo="erro">{erro.texto}</Aviso>}

      {!painel && carregando && <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="size-5 animate-spin" /> Carregando o dashboard…</p>}

      {painel && resumo && bates && (
        <div className={cx('space-y-6 transition-opacity', carregando && 'opacity-50')}>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
            <Cartao titulo="Auditorias a iniciar" valor={inteiro(resumo.auditorias_a_iniciar)} detalhe={`${inteiro(resumo.total_bases_disponiveis)} bases no período`} icone={<Clock className="size-5" />} cor="text-sky-700 dark:text-sky-300" />
            <Cartao titulo="Em andamento" valor={inteiro(resumo.auditorias_em_andamento)} detalhe="Auditorias ativas"
              alerta={resumo.auditorias_em_andamento_atrasadas ? `${inteiro(resumo.auditorias_em_andamento_atrasadas)} há mais de ${resumo.dias_limite_atraso} dias` : null}
              icone={<Activity className="size-5" />} cor="text-amber-700 dark:text-amber-300" />
            <Cartao titulo="Finalizadas" valor={inteiro(resumo.auditorias_finalizadas)} detalhe="Auditorias completas" icone={<CheckCircle2 className="size-5" />} cor="text-emerald-700 dark:text-emerald-400" />
            <Cartao titulo="Total de bates" valor={inteiro(bates.total_bates)} detalhe={`${inteiro(bates.total_pendencias)} pendências`} nota={`${inteiro(bates.bates_hoje)} bates hoje`} icone={<Target className="size-5" />} cor="text-violet-700 dark:text-violet-300" />
          </div>
          {resumo.total_bases_disponiveis === 0 ? (
            <Vazio icone={<IconeRabisco tipo="star" tamanho={44} />} titulo="Nenhuma base neste período">As bases entram no período pela data de referência. Troque o período, escolha &quot;Histórico completo&quot; ou suba uma base em Gestão › Upload Base.</Vazio>
          ) : (
            <>
              <PainelConcluido painel={painel} />
              <TabelaFundos fundos={painel.fundos} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
