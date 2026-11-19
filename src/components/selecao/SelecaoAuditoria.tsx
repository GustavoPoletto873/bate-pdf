'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, PlayCircle, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type { CartaoAuditoria as Cartao, PaginaSelecao } from '@/app/api/auditorias/selecao';
import type { StatusAuditoria } from '@/lib/auditoria';
import { apiSelecao } from '@/lib/cliente/selecao';
import { formatarCpfCnpj } from '@/lib/texto';
import { Vazio } from '@/components/Pagina';
import { Aviso, Botao, Dialogo, cx } from '@/components/ui';
import { IconeRabisco } from '@/components/rabiscos';
import { mensagemDeErro, useAtrasado } from '@/components/fundos/util';
import { CartaoAuditoria } from './CartaoAuditoria';
import { descreverPeriodo, FILTROS_VAZIOS, TRIMESTRES, useFiltrosSalvos } from './filtros';

const STATUS: { valor: StatusAuditoria; rotulo: string; chave: 'a_iniciar' | 'em_andamento' | 'finalizadas'; Icone: typeof Clock }[] = [
  { valor: 'a_iniciar', rotulo: 'A Iniciar', chave: 'a_iniciar', Icone: Clock },
  { valor: 'em_andamento', rotulo: 'Em Andamento', chave: 'em_andamento', Icone: PlayCircle },
  { valor: 'finalizada', rotulo: 'Finalizadas', chave: 'finalizadas', Icone: CheckCircle2 },
];

type Carga = { chave: string; dados: PaginaSelecao | null; erro: string | null };

function anosDisponiveis(selecionado: string): string[] {
  const atual = new Date().getFullYear();
  const anos = Array.from({ length: 7 }, (_, i) => String(atual - i));
  if (selecionado && !anos.includes(selecionado)) anos.push(selecionado);
  return anos.sort((a, b) => b.localeCompare(a));
}

/** Bates › Seleção de Auditoria (AuditoriaSelection.jsx + FiltrosAuditoria.jsx). */
export function SelecaoAuditoria({ statusInicial }: { statusInicial: StatusAuditoria }) {
  const [filtros, alterarFiltros] = useFiltrosSalvos();
  const busca = useAtrasado(filtros.busca.trim(), 300);
  const [status, setStatus] = useState<StatusAuditoria>(statusInicial);
  const chaveFiltro = JSON.stringify([busca, filtros.tipo, filtros.ano, filtros.trimestre, filtros.data, status]);
  const [paginacao, setPaginacao] = useState({ chave: chaveFiltro, pagina: 1 });
  const pagina = paginacao.chave === chaveFiltro ? paginacao.pagina : 1;
  const [recarga, setRecarga] = useState(0);
  const chaveCarga = JSON.stringify([chaveFiltro, pagina, recarga]);
  const [carga, setCarga] = useState<Carga | null>(null);
  const carregando = carga?.chave !== chaveCarga;
  const dados = carga?.dados ?? null;
  const [exclusao, setExclusao] = useState<Cartao | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    // chaveCarga = JSON de [chaveFiltro (já um JSON), página, recarga]: são dois níveis.
    const [filtroJson, p] = JSON.parse(chaveCarga) as [string, number, number];
    const [b, tipo, ano, trimestre, data, st] = JSON.parse(filtroJson) as [string, 'trimestre' | 'data', string, string, string, StatusAuditoria];
    apiSelecao.listar({ busca: b, tipo, ano, trimestre, data, status: st, pagina: p })
      .then((d) => { if (vivo) setCarga({ chave: chaveCarga, dados: d, erro: null }); })
      .catch((e) => { if (vivo) setCarga((atual) => ({ chave: chaveCarga, dados: atual?.dados ?? null, erro: mensagemDeErro(e, 'Não foi possível carregar as bases. Tente de novo.') })); });
    return () => { vivo = false; };
  }, [chaveCarga]);

  // "/" leva direto para a busca (como no GitHub), sem precisar do mouse.
  useEffect(() => {
    const teclar = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))) return;
      e.preventDefault();
      buscaRef.current?.focus();
    };
    window.addEventListener('keydown', teclar);
    return () => window.removeEventListener('keydown', teclar);
  }, []);

  function escolherStatus(s: StatusAuditoria) {
    setStatus(s);
    window.history.replaceState(null, '', `?status=${s}`);
  }
  const irPara = (p: number) => setPaginacao({ chave: chaveFiltro, pagina: p });

  function selecionarTrimestre(valor: string) {
    // Clicar no trimestre ativo desmarca; escolher um trimestre sem ano assume o ano corrente.
    const novo = filtros.trimestre === valor ? '' : valor;
    alterarFiltros({ trimestre: novo, ano: novo && !filtros.ano ? String(new Date().getFullYear()) : filtros.ano });
  }
  function selecionarAno(ano: string) {
    alterarFiltros({ ano, ...(ano ? {} : { trimestre: '' }), ...(filtros.data && ano && !filtros.data.startsWith(`${ano}-`) ? { data: '' } : {}) });
  }
  // Mantém a escolha Trimestre/Data: é preferência, não filtro.
  const limpar = () => alterarFiltros({ ...FILTROS_VAZIOS, tipo: filtros.tipo });
  const temFiltro = Boolean(filtros.busca.trim() || filtros.ano || filtros.trimestre || filtros.data);
  const buscando = carregando || filtros.busca.trim() !== busca;

  async function excluir() {
    if (!exclusao) return;
    setExcluindo(true);
    try {
      await apiSelecao.excluir(exclusao.base_id);
      setAviso({ tipo: 'ok', texto: `Base "${exclusao.nome}" excluída.` });
      setRecarga((n) => n + 1);
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDeErro(e, 'Não foi possível excluir a base. Tente de novo.') });
    } finally {
      setExcluindo(false);
      setExclusao(null);
    }
  }

  const resumo = dados?.resumo;
  const rotuloStatus = STATUS.find((s) => s.valor === status)!.rotulo;

  return (
    <div className="space-y-6">
      <div className="lastro-cartao space-y-4 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input
            ref={buscaRef} type="search" value={filtros.busca}
            onChange={(e) => alterarFiltros({ busca: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Escape' && filtros.busca) { e.preventDefault(); alterarFiltros({ busca: '' }); } }}
            placeholder="Buscar por nome da base, nome do fundo ou CNPJ…" aria-label="Buscar por nome da base, nome do fundo ou CNPJ"
            autoComplete="off" spellCheck={false}
            className="lastro-campo h-12 w-full pl-12 pr-24 text-base [&::-webkit-search-cancel-button]:hidden"
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {buscando && <span role="status" aria-label="Buscando" className="size-4 animate-spin rounded-full border-2 border-slate-900 border-t-transparent dark:border-slate-100 dark:border-t-transparent" />}
            {filtros.busca ? (
              <button type="button" onClick={() => { alterarFiltros({ busca: '' }); buscaRef.current?.focus(); }} aria-label="Limpar busca" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"><X className="size-4" /></button>
            ) : (
              <kbd className="hidden h-6 min-w-6 place-items-center rounded-md border border-slate-300 px-1.5 text-[11px] font-semibold text-slate-500 sm:grid dark:border-slate-700 dark:text-slate-400">/</kbd>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <span className="lastro-rotulo">Referência</span>
            <div role="radiogroup" aria-label="Tipo de período" className="inline-flex rounded-full border-[1.5px] border-slate-300 p-0.5 dark:border-slate-600">
              {(['trimestre', 'data'] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={filtros.tipo === t} onClick={() => alterarFiltros({ tipo: t })}
                  className={cx('h-8 rounded-full px-3 text-sm font-semibold', filtros.tipo === t ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}>
                  {t === 'trimestre' ? 'Trimestre' : 'Data'}
                </button>
              ))}
            </div>
            <select value={filtros.ano} onChange={(e) => selecionarAno(e.target.value)} aria-label="Ano de referência" className="lastro-campo h-10 px-3 text-sm">
              <option value="">Todos os anos</option>
              {anosDisponiveis(filtros.ano).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {filtros.tipo === 'trimestre' ? (
              <div className="flex gap-1.5" role="group" aria-label="Trimestre">
                {TRIMESTRES.map((t) => {
                  const ativo = filtros.trimestre === t.valor;
                  return (
                    <button key={t.valor} type="button" aria-pressed={ativo} onClick={() => selecionarTrimestre(t.valor)} title={`${t.rotulo} (${t.meses})`}
                      className={cx('flex h-10 min-w-[4.25rem] flex-col items-center justify-center rounded-xl border-[1.5px] px-2.5 text-sm leading-tight transition-colors',
                        ativo ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-slate-300 hover:border-slate-900 dark:border-slate-600 dark:hover:border-slate-200')}>
                      <span className="font-semibold">{t.rotulo}</span>
                      <span className={cx('text-[10px]', ativo ? 'opacity-80' : 'text-slate-500 dark:text-slate-400')}>{t.meses}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <input type="date" value={filtros.data} aria-label="Data de referência exata"
                min={filtros.ano ? `${filtros.ano}-01-01` : undefined} max={filtros.ano ? `${filtros.ano}-12-31` : undefined}
                onChange={(e) => alterarFiltros({ data: e.target.value, ano: e.target.value ? e.target.value.slice(0, 4) : filtros.ano })}
                className="lastro-campo h-10 px-3 text-sm dark:[color-scheme:dark]" />
            )}
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 xl:ml-auto">
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
              <CalendarDays className="size-4 shrink-0" />
              <span className="truncate">
                {resumo && !buscando && <b className="font-semibold text-slate-900 dark:text-slate-100">{resumo.total} {resumo.total === 1 ? 'base' : 'bases'} </b>}
                {descreverPeriodo(filtros)}
                {filtros.busca.trim() && <> contendo “<b className="font-semibold text-slate-900 dark:text-slate-100">{filtros.busca.trim()}</b>”</>}
              </span>
            </p>
            {temFiltro && <Botao tamanho="sm" variante="fantasma" onClick={limpar}><RotateCcw className="size-3.5" /> Limpar</Botao>}
            <Botao tamanho="sm" onClick={() => setRecarga((n) => n + 1)} disabled={carregando} aria-label="Atualizar lista"><RefreshCw className={cx('size-3.5', carregando && 'animate-spin')} /> Atualizar</Botao>
          </div>
        </div>
      </div>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {carga?.erro && !carregando && (
        <Aviso tipo="erro">{carga.erro} <button type="button" className="font-semibold underline" onClick={() => setRecarga((n) => n + 1)}>Tentar de novo</button></Aviso>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {STATUS.map((s) => {
          const ativo = status === s.valor;
          return (
            <button key={s.valor} type="button" onClick={() => escolherStatus(s.valor)} aria-pressed={ativo}
              className={cx('rounded-2xl border-2 px-5 py-4 text-left transition-transform hover:-translate-y-0.5',
                ativo ? 'border-slate-900 bg-slate-900 text-white shadow-[4px_4px_0_var(--lastro-destaque)] dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                  : 'border-slate-300 bg-white hover:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-200')}>
              <p className="flex items-center gap-2 text-sm font-semibold"><s.Icone className="size-4" /> {s.rotulo}</p>
              <p className="mt-1 font-display text-3xl tabular-nums">{resumo ? resumo[s.chave] : '–'}</p>
            </button>
          );
        })}
      </div>

      <div aria-busy={carregando} className={cx('transition-opacity', carregando && dados && 'pointer-events-none opacity-60')}>
        {!dados && carregando && <p className="py-12 text-center font-serif text-sm text-slate-500 dark:text-slate-400">Carregando as bases…</p>}
        {dados && dados.itens.length === 0 && (
          <Vazio icone={<IconeRabisco tipo={temFiltro ? 'lupa' : 'pdf'} tamanho={44} />} titulo={temFiltro ? 'Nenhuma base encontrada' : `Nenhuma base em “${rotuloStatus}”`}>
            {temFiltro
              ? <>Nada em “{rotuloStatus}” {descreverPeriodo(filtros)}{filtros.busca.trim() && <> contendo “{filtros.busca.trim()}”</>}. Tente outra categoria, termo ou período.</>
              : resumo?.total
                ? 'Veja as outras categorias acima.'
                : <>Ainda não há bases. <Link href="/base" className="font-semibold underline decoration-wavy decoration-indigo-500 underline-offset-4">Registre uma base no Upload Base</Link>.</>}
            {temFiltro && <div className="mt-4"><Botao onClick={limpar}><X className="size-4" /> Limpar filtros</Botao></div>}
          </Vazio>
        )}
        {dados && dados.itens.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {dados.itens.map((a) => <CartaoAuditoria key={a.base_id} a={a} onExcluir={setExclusao} />)}
          </div>
        )}
      </div>

      {dados && dados.paginas > 1 && (
        <nav aria-label="Páginas" className="flex flex-wrap items-center justify-center gap-2">
          <Botao tamanho="sm" onClick={() => irPara(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior"><ChevronLeft className="size-4" /></Botao>
          {Array.from({ length: dados.paginas }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === dados.paginas || Math.abs(p - pagina) <= 2)
            .map((p, i, lista) => (
              <span key={p} className="flex items-center gap-2">
                {i > 0 && p - lista[i - 1] > 1 && <span className="text-slate-400">…</span>}
                <Botao tamanho="sm" variante={p === pagina ? 'primario' : 'secundario'} onClick={() => irPara(p)} aria-current={p === pagina ? 'page' : undefined}>{p}</Botao>
              </span>
            ))}
          <Botao tamanho="sm" onClick={() => irPara(pagina + 1)} disabled={pagina >= dados.paginas} aria-label="Próxima página"><ChevronRight className="size-4" /></Botao>
          <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">Página {pagina} ({dados.total} bases)</span>
        </nav>
      )}

      <Dialogo
        aberto={!!exclusao}
        titulo="Excluir base"
        onFechar={() => !excluindo && setExclusao(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setExclusao(null)} disabled={excluindo}>Cancelar</Botao>
          <Botao variante="perigo" onClick={excluir} disabled={excluindo}><Trash2 className="size-4" /> {excluindo ? 'Excluindo…' : 'Excluir base'}</Botao>
        </>}
      >
        {exclusao && (
          <div className="space-y-3 text-sm">
            <p>Esta base será apagada <b>permanentemente</b> deste computador:</p>
            <div className="rounded-xl border-2 border-dashed border-rose-300 p-3 dark:border-rose-500/40">
              <p className="font-semibold">{exclusao.nome}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{exclusao.nome_fundo}{exclusao.cnpj_fundo ? ` · ${formatarCpfCnpj(exclusao.cnpj_fundo)}` : ''}</p>
            </div>
            <ul className="list-disc space-y-0.5 pl-5 text-slate-600 dark:text-slate-400">
              <li>os títulos e as pendências</li>
              <li>os PDFs enviados (inclusive os arquivos) e as leituras</li>
              <li>os bates, os pré-bates e as marcações V/D/P</li>
            </ul>
            <Aviso tipo="alerta">Se ainda não levou o resultado para o Bate Lastro, exporte antes em Resultados.</Aviso>
          </div>
        )}
      </Dialogo>
    </div>
  );
}
