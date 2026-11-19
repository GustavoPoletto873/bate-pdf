'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Copy, Download, FileStack, Link2, ListChecks, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { api, ErroApi, type ResultadoPreClassificacaoTela, type SugestaoTitulo } from '@/lib/cliente';
import type { BaseResumo, OperacaoMarcacao, PendenciaLinha, ResultadoBusca } from '@/lib/repo';
import { camposDoLado, type CampoId, type Veredito } from '@/lib/campos';
import { normalizarTexto } from '@/lib/texto';
import { Aviso, Botao, cx, Etiqueta } from '@/components/ui';
import { IconeRabisco } from '@/components/rabiscos';
import { ListaPendencias } from '@/components/bater/ListaPendencias';
import { DetalhePendencia, type PdfAberto } from '@/components/bater/DetalhePendencia';
import { PainelBusca, type ControleBusca } from '@/components/bater/PainelBusca';
import { VisualizadorPdf } from '@/components/pdf/VisualizadorPdf';
import { DialogoPdfs } from '@/components/bater/DialogoPdfs';
import { DialogoExportar } from '@/components/bater/DialogoExportar';
import { Conferencia } from '@/components/bater/Conferencia';
import { ROTULO_CONFIANCA } from '@/components/bater/preClassificacao';

type Filtro = { lado: 'todos' | 'termo' | 'lastro'; situacao: 'pendente' | 'vinculado' | 'todas'; texto: string; sugestao: 'todas' | 'com' | 'sem' };
type Mensagem = { tipo: 'ok' | 'erro' | 'alerta' | 'info'; texto: string } | null;

export function BaterPdf({ baseId }: { baseId: string }) {
  const [base, setBase] = useState<BaseResumo | null>(null);
  const [indexando, setIndexando] = useState(false);
  const [pendencias, setPendencias] = useState<PendenciaLinha[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>({ lado: 'todos', situacao: 'pendente', texto: '', sugestao: 'todas' });
  const [ativa, setAtiva] = useState<number | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [pdfAberto, setPdfAberto] = useState<PdfAberto | null>(null);
  const [sinalIrPara, setSinalIrPara] = useState(0);
  const buscaRef = useRef<ControleBusca>(null);
  const [pre, setPre] = useState<{ executado_em: string; duracao_ms: number; resultado: ResultadoPreClassificacaoTela } | null>(null);
  const [preRodando, setPreRodando] = useState(false);
  const [modo, setModo] = useState<'bater' | 'conferencia'>('bater');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [dialogo, setDialogo] = useState<'pdfs' | 'exportar' | null>(null);
  const [copiada, setCopiada] = useState<{ lado: string; marcas: Partial<Record<CampoId, { valor: Veredito; valor_digitado: string | null }>> } | null>(null);
  const ultimoClique = useRef<number | null>(null);

  const avisar = useCallback((tipo: NonNullable<Mensagem>['tipo'], texto: string) => {
    setMensagem({ tipo, texto });
    if (tipo === 'ok' || tipo === 'info') setTimeout(() => setMensagem((m) => (m?.texto === texto ? null : m)), 6000);
  }, []);

  const carregarBase = useCallback(() => api.base(baseId).then((r) => { setBase(r.base); setIndexando(r.indexando); }).catch((e: ErroApi) => setErroCarga(e.message)), [baseId]);
  const carregarPendencias = useCallback(() => api.pendencias(baseId).then((r) => setPendencias(r.pendencias)).catch((e: ErroApi) => setErroCarga(e.message)), [baseId]);

  useEffect(() => {
    carregarBase();
    carregarPendencias();
    api.ultimaPreClassificacao(baseId).then((r) => r && setPre(r)).catch(() => {});
  }, [baseId, carregarBase, carregarPendencias]);

  // Indexação em segundo plano: acompanha até terminar.
  useEffect(() => {
    if (!base || (!indexando && base.pdfs.pendentes === 0)) return;
    const t = setInterval(carregarBase, 2500);
    return () => clearInterval(t);
  }, [base, indexando, carregarBase]);

  const sugestoes = useMemo(() => {
    const m: Record<number, SugestaoTitulo> = {};
    for (const s of pre?.resultado.resultados ?? []) m[s.registro_base_id] = s;
    return m;
  }, [pre]);
  const nomesPdfs = useMemo(() => pre?.resultado.nomes_pdfs ?? {}, [pre]);

  const filtradas = useMemo(() => {
    const alvo = normalizarTexto(filtro.texto.trim());
    const digitosAlvo = filtro.texto.replace(/\D/g, '');
    return (pendencias ?? []).filter((l) => {
      if (filtro.lado !== 'todos' && l.lado !== filtro.lado) return false;
      if (filtro.situacao === 'pendente' && l.situacao !== 'pendente') return false;
      if (filtro.situacao === 'vinculado' && l.situacao === 'pendente') return false;
      if (filtro.sugestao !== 'todas') {
        const tem = Boolean(sugestoes[l.titulo_id]?.candidatos?.[l.lado]);
        if ((filtro.sugestao === 'com') !== tem) return false;
      }
      if (!alvo) return true;
      const t = l.titulo;
      return normalizarTexto(`${t.numero_documento ?? ''} ${t.sacado_nome ?? ''} ${t.cedente_nome ?? ''}`).includes(alvo)
        || (digitosAlvo.length >= 3 && `${t.sacado_documento ?? ''}${t.cedente_documento ?? ''}`.replace(/\D/g, '').includes(digitosAlvo));
    });
  }, [pendencias, filtro, sugestoes]);

  const linhaAtiva = useMemo(() => pendencias?.find((l) => l.pendencia_id === ativa) ?? null, [pendencias, ativa]);

  // Navegação pelo teclado (↑/↓) quando o foco não está num campo.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName) || modo !== 'bater') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = filtradas.findIndex((l) => l.pendencia_id === ativa);
      const prox = filtradas[Math.min(filtradas.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (prox) setAtiva(prox.pendencia_id);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [filtradas, ativa, modo]);

  // ------------------------------------------------------------------ ações

  const aplicarLocal = (ops: OperacaoMarcacao[]) => {
    setPendencias((atual) => {
      if (!atual) return atual;
      const porId = new Map<number, OperacaoMarcacao[]>();
      for (const op of ops) porId.set(op.pendencia_id, [...(porId.get(op.pendencia_id) ?? []), op]);
      return atual.map((l) => {
        const lista = porId.get(l.pendencia_id);
        if (!lista) return l;
        const marcacoes = { ...l.marcacoes };
        for (const op of lista) {
          if (op.valor === null) delete marcacoes[op.campo];
          else marcacoes[op.campo] = { valor: op.valor, valor_digitado: op.valor === 'D' ? (op.valor_digitado ?? '') : null, origem: op.origem ?? 'manual' };
        }
        return { ...l, marcacoes };
      });
    });
  };

  const marcar = useCallback(async (ops: OperacaoMarcacao[]) => {
    if (!ops.length) return;
    const antes = pendencias;
    aplicarLocal(ops);
    try {
      for (let i = 0; i < ops.length; i += 2000) await api.salvarMarcacoes(baseId, ops.slice(i, i + 2000));
    } catch (e) {
      setPendencias(antes);
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível gravar as marcações.');
    }
  }, [pendencias, baseId, avisar]);

  const alvoDoVinculo = useCallback((): PendenciaLinha[] => {
    const ids = selecionadas.size ? [...selecionadas] : ativa ? [ativa] : [];
    const porId = new Map((pendencias ?? []).map((l) => [l.pendencia_id, l]));
    return ids.map((id) => porId.get(id)).filter((l): l is PendenciaLinha => Boolean(l && l.situacao === 'pendente'));
  }, [selecionadas, ativa, pendencias]);

  const vincular = useCallback(async (pdfId: number, pagina: number | null, linhas?: PendenciaLinha[]) => {
    const alvo = linhas ?? alvoDoVinculo();
    if (!alvo.length) {
      avisar('alerta', 'Selecione na lista a(s) pendência(s) a vincular.');
      return;
    }
    setOcupado(true);
    try {
      const r = await api.vincular(baseId, alvo.map((l) => ({ pendencia_id: l.pendencia_id, pdf_id: pdfId, pagina, origem: 'manual' })));
      avisar('ok', `${r.vinculados} pendência(s) batida(s).`);
      setSelecionadas(new Set());
      // Vai para a próxima pendente.
      const restantes = filtradas.filter((l) => l.situacao === 'pendente' && !alvo.some((a) => a.pendencia_id === l.pendencia_id));
      const i = filtradas.findIndex((l) => l.pendencia_id === ativa);
      const proxima = restantes.find((l) => filtradas.indexOf(l) > i) ?? restantes[0];
      await Promise.all([carregarPendencias(), carregarBase()]);
      // A linha ativa foi batida: segue para a próxima pendente da lista.
      if (proxima && alvo.some((a) => a.pendencia_id === ativa)) setAtiva(proxima.pendencia_id);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 409) {
        const recusados = (e.dados as { recusados?: { motivo: string }[] })?.recusados ?? [];
        avisar('alerta', `Nada foi vinculado. ${recusados.length > 1 ? `${recusados.length} pendências travadas — ` : ''}${recusados.slice(0, 3).map((r) => r.motivo).join('; ')}. Marque V ou D em cada campo antes de vincular.`);
      } else {
        avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível vincular.');
      }
    } finally {
      setOcupado(false);
    }
  }, [alvoDoVinculo, baseId, avisar, filtradas, ativa, carregarPendencias, carregarBase]);

  const desvincular = useCallback(async (ids: number[]) => {
    if (!window.confirm('Desfazer o vínculo? A pendência volta a ficar aberta, com as marcações que tinha.')) return;
    setOcupado(true);
    try {
      await api.desvincular(baseId, ids);
      await Promise.all([carregarPendencias(), carregarBase()]);
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível desfazer.');
    } finally {
      setOcupado(false);
    }
  }, [baseId, carregarPendencias, carregarBase, avisar]);

  const abrirPdf = useCallback((pdfId: number, pagina: number | null, termo?: string | null, nome?: string) => {
    setPdfAberto((atual) => ({
      pdf_id: pdfId,
      nome: nome ?? nomesPdfs[String(pdfId)] ?? (atual?.pdf_id === pdfId ? atual.nome : `PDF ${pdfId}`),
      pagina,
      termo: termo === undefined ? (atual?.pdf_id === pdfId ? atual.termo : null) : termo,
    }));
    setSinalIrPara((s) => s + 1);
    if (!nome && !nomesPdfs[String(pdfId)]) {
      api.pdfs(baseId).then((r) => {
        const p = r.pdfs.find((x) => x.id === pdfId);
        if (p) setPdfAberto((a) => (a && a.pdf_id === pdfId ? { ...a, nome: p.nome_arquivo } : a));
      }).catch(() => {});
    }
  }, [nomesPdfs, baseId]);

  const preClassificar = async () => {
    setPreRodando(true);
    try {
      const r = await api.preClassificar(baseId);
      setPre(r);
      const resumo = Object.entries(r.resultado.resumo).filter(([, n]) => n).map(([c, n]) => `${n} ${ROTULO_CONFIANCA[c]?.texto.toLowerCase() ?? c}`).join(', ');
      avisar('ok', `Pré-classificação pronta em ${(r.duracao_ms / 1000).toFixed(1)} s: ${resumo || 'nenhuma pendência'}.`);
      setModo('conferencia');
      carregarBase();
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'A pré-classificação falhou.');
    } finally {
      setPreRodando(false);
    }
  };

  const copiarMarcacoes = () => {
    if (!linhaAtiva) return;
    setCopiada({ lado: linhaAtiva.lado, marcas: linhaAtiva.marcacoes });
    avisar('info', 'Marcações copiadas. Selecione outras pendências e clique em "Colar".');
  };
  const colarMarcacoes = () => {
    if (!copiada) return;
    const alvos = (pendencias ?? []).filter((l) => selecionadas.has(l.pendencia_id) && l.situacao === 'pendente');
    const ops: OperacaoMarcacao[] = alvos.flatMap((l) => camposDoLado(l.lado).map((c) => {
      const m = copiada.marcas[c.campo];
      return { pendencia_id: l.pendencia_id, campo: c.campo, valor: m?.valor ?? null, valor_digitado: m?.valor_digitado ?? null };
    }));
    marcar(ops);
    avisar('ok', `Marcações coladas em ${alvos.length} pendência(s).`);
  };

  const alternarSelecao = useCallback((id: number, comShift: boolean) => {
    setSelecionadas((atual) => {
      const nova = new Set(atual);
      if (comShift && ultimoClique.current !== null) {
        const ids = filtradas.map((l) => l.pendencia_id);
        const [a, b] = [ids.indexOf(ultimoClique.current), ids.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0) for (const i of ids.slice(a, b + 1)) nova.add(i);
      } else if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      ultimoClique.current = id;
      return nova;
    });
  }, [filtradas]);

  // ------------------------------------------------------------------ tela

  if (erroCarga) return <div className="p-6"><Aviso tipo="erro">{erroCarga}</Aviso></div>;
  if (!base || !pendencias) return <p className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Carregando a base…</p>;

  const pendentesTotal = base.pendentes.termo + base.pendentes.lastro;
  const batidos = base.vinculados.termo + base.vinculados.lastro;
  const alvoVinculo = alvoDoVinculo();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Barra da base */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
        <Link href="/auditoria-selection" className="text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400">← Bates</Link>
        <Link href={`/pre-matches?base=${baseId}`} className="text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400" title="Processar a base, confirmar os pré-bates e ver os resultados">Gestão de Bates</Link>
        <h1 className="truncate font-display text-lg tracking-tight">{base.nome}</h1>
        <Etiqueta cor={pendentesTotal ? 'amber' : 'emerald'}>{pendentesTotal} pendentes</Etiqueta>
        <Etiqueta cor="emerald">{batidos} batidos aqui</Etiqueta>
        <button type="button" onClick={() => setDialogo('pdfs')}>
          <Etiqueta cor="sky" titulo="Ver e enviar PDFs">
            {(indexando || base.pdfs.pendentes > 0) && <Loader2 className="size-3 animate-spin" />}
            {base.pdfs.indexados}/{base.pdfs.total} PDFs com texto
          </Etiqueta>
        </button>
        {base.pdfs.sem_texto > 0 && <Etiqueta cor="orange" titulo="Escaneados, sem camada de texto: não entram na busca nem na pré-classificação">{base.pdfs.sem_texto} sem texto</Etiqueta>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border-[1.5px] border-slate-900 bg-white p-0.5 dark:border-slate-200 dark:bg-slate-900">
            <button type="button" onClick={() => setModo('bater')} className={cx('rounded-full px-3 py-1 text-xs font-bold transition-colors', modo === 'bater' ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white')}>Bater PDF</button>
            <button type="button" onClick={() => setModo('conferencia')} disabled={!pre} className={cx('rounded-full px-3 py-1 text-xs font-bold transition-colors disabled:opacity-40', modo === 'conferencia' ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white')} title={pre ? '' : 'Rode a pré-classificação primeiro'}>
              <ListChecks className="mr-1 inline size-3.5" />Conferência
            </button>
          </div>
          <Botao tamanho="sm" onClick={preClassificar} disabled={preRodando || base.pdfs.indexados === 0} title={base.pdfs.indexados === 0 ? 'Envie e indexe os PDFs primeiro' : 'Analisa a base inteira e sugere PDF e V/D por campo — não grava nada sozinho'}>
            {preRodando ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-violet-600" />}
            {preRodando ? 'Pré-classificando…' : pre ? 'Pré-classificar de novo' : 'Pré-classificar pendências'}
          </Botao>
          <Botao tamanho="sm" onClick={() => setDialogo('pdfs')}><FileStack className="size-3.5" /> PDFs</Botao>
          <Botao tamanho="sm" variante="primario" onClick={() => setDialogo('exportar')}><Download className="size-3.5" /> Exportar p/ Bate Lastro</Botao>
        </div>
      </div>
      {pre && modo === 'bater' && (
        <div className="shrink-0 border-b border-violet-200 bg-violet-50/70 px-3 py-1 text-xs text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
          <Sparkles className="mr-1 inline size-3" />
          Pré-classificação de {new Date(pre.executado_em).toLocaleString('pt-BR')}: {Object.entries(pre.resultado.resumo).filter(([, n]) => n).map(([c, n]) => `${n} ${ROTULO_CONFIANCA[c]?.texto.toLowerCase() ?? c}`).join(' · ')}.
          {' '}As sugestões aparecem em tom apagado com contorno roxo até alguém decidir.
        </div>
      )}
      {mensagem && (
        <div className="shrink-0 px-3 pt-2">
          <div className="relative">
            <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>
            <button type="button" className="absolute right-2 top-1.5 text-slate-500" onClick={() => setMensagem(null)} aria-label="Fechar aviso">×</button>
          </div>
        </div>
      )}

      {modo === 'conferencia' && pre ? (
        <Conferencia
          baseId={baseId}
          pre={pre.resultado}
          pendencias={pendencias}
          ocupado={ocupado}
          onMarcar={marcar}
          onVincular={async (itens) => {
            setOcupado(true);
            try {
              const r = await api.vincular(baseId, itens);
              await Promise.all([carregarPendencias(), carregarBase()]);
              return r;
            } finally {
              setOcupado(false);
            }
          }}
          onAbrirNoBater={(pendenciaId, pdfId, pagina) => {
            setModo('bater');
            setFiltro((f) => ({ ...f, situacao: 'todas', texto: '' }));
            setAtiva(pendenciaId);
            if (pdfId) abrirPdf(pdfId, pagina, null);
          }}
          avisar={avisar}
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(420px,46%)_1fr]">
          {/* Esquerda: pendências + detalhe */}
          <section className="flex min-h-0 flex-col border-r border-slate-200 dark:border-slate-800">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
              <select className="lastro-campo h-7 px-2 text-xs" value={filtro.lado} onChange={(e) => setFiltro({ ...filtro, lado: e.target.value as Filtro['lado'] })} aria-label="Lado">
                <option value="todos">Termo e Lastro</option><option value="termo">Só Termo</option><option value="lastro">Só Lastro</option>
              </select>
              <select className="lastro-campo h-7 px-2 text-xs" value={filtro.situacao} onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value as Filtro['situacao'] })} aria-label="Situação">
                <option value="pendente">Pendentes</option><option value="vinculado">Batidos</option><option value="todas">Todas</option>
              </select>
              {pre && (
                <select className="lastro-campo h-7 px-2 text-xs" value={filtro.sugestao} onChange={(e) => setFiltro({ ...filtro, sugestao: e.target.value as Filtro['sugestao'] })} aria-label="Sugestão">
                  <option value="todas">Com e sem PDF sugerido</option><option value="com">Com PDF sugerido</option><option value="sem">Sem PDF sugerido</option>
                </select>
              )}
              <input
                className="lastro-campo h-7 min-w-0 flex-1 px-3 text-xs"
                placeholder="Filtrar por nº, nome ou CPF/CNPJ"
                value={filtro.texto}
                onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })}
              />
              <span className="text-[11px] text-slate-500">{filtradas.length}</span>
              <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Recarregar" onClick={() => { carregarPendencias(); carregarBase(); }}><RefreshCw className="size-3.5" /></button>
            </div>
            {selecionadas.size > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-sky-200 bg-sky-50 px-2 py-1 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                <span className="font-medium">{selecionadas.size} selecionada(s)</span>
                {copiada && <Botao tamanho="sm" onClick={colarMarcacoes}><ClipboardPaste className="size-3.5" /> Colar marcações</Botao>}
                <Botao tamanho="sm" variante="primario" disabled={!pdfAberto || ocupado || !alvoVinculo.length} onClick={() => pdfAberto && vincular(pdfAberto.pdf_id, pdfAberto.pagina)} title={pdfAberto ? `Vincular as selecionadas a ${pdfAberto.nome}` : 'Abra um PDF à direita'}>
                  <Link2 className="size-3.5" /> Vincular {alvoVinculo.length} ao PDF aberto
                </Botao>
                <button type="button" className="ml-auto text-slate-500 hover:text-slate-700" onClick={() => setSelecionadas(new Set())}>limpar seleção</button>
              </div>
            )}
            <div className="flex min-h-0 flex-[1_1_45%] flex-col">
              <ListaPendencias
                linhas={filtradas}
                ativa={ativa}
                selecionadas={selecionadas}
                sugestoes={sugestoes}
                onAtivar={setAtiva}
                onAlternarSelecao={alternarSelecao}
                onSelecionarTodas={(marcar) => setSelecionadas(marcar ? new Set(filtradas.map((l) => l.pendencia_id)) : new Set())}
              />
            </div>
            <div className="flex min-h-0 flex-[1_1_55%] flex-col border-t-2 border-slate-200 dark:border-slate-800">
              {linhaAtiva ? (
                <>
                  <DetalhePendencia
                    baseId={baseId}
                    linha={linhaAtiva}
                    sugestao={sugestoes[linhaAtiva.titulo_id]}
                    nomesPdfs={nomesPdfs}
                    pdfAberto={pdfAberto}
                    ocupado={ocupado}
                    onMarcar={marcar}
                    onBuscar={(termos, rotulo) => buscaRef.current?.buscar(termos, rotulo)}
                    onAbrirPdf={(id, pagina, termo) => abrirPdf(id, pagina, termo)}
                    onVincular={async (pdfId, pagina, antes) => {
                      if (antes?.length) await marcar(antes);
                      await vincular(pdfId, pagina, [linhaAtiva]);
                    }}
                    onDesvincular={() => desvincular([linhaAtiva.pendencia_id])}
                  />
                  {linhaAtiva.situacao === 'pendente' && (
                    <div className="flex shrink-0 gap-2 border-t border-slate-200 px-3 py-1 text-[11px] text-slate-500 dark:border-slate-800">
                      <button type="button" className="flex items-center gap-1 hover:text-slate-700" onClick={copiarMarcacoes}><Copy className="size-3" /> copiar marcações desta linha</button>
                      <span>·</span><span>↑/↓ navega na lista</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="grid flex-1 place-items-center p-6 text-center"><div><IconeRabisco tipo="v" tamanho={40} className="mx-auto -rotate-6 text-slate-900 dark:text-slate-200" /><p className="mt-3 font-serif text-[15px] text-slate-600 dark:text-slate-400">Escolha uma pendência na lista para conferir os campos.</p></div></div>
              )}
            </div>
          </section>

          {/* Direita: busca + visualizador */}
          <section className="flex min-h-0 flex-col">
            <PainelBusca
              ref={buscaRef}
              baseId={baseId}
              pdfAbertoId={pdfAberto?.pdf_id ?? null}
              podeVincular={alvoVinculo.length > 0}
              onAbrir={(r: ResultadoBusca, termo) => abrirPdf(r.pdf_id, r.pagina, termo, r.nome_arquivo)}
              onVincular={(r) => vincular(r.pdf_id, r.pagina)}
            />
            {pdfAberto ? (
              <>
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 px-3 text-xs dark:border-slate-800">
                  <IconeRabisco tipo="pdf" tamanho={16} className="shrink-0 text-slate-900 dark:text-slate-200" />
                  <span className="truncate font-semibold" title={pdfAberto.nome}>{pdfAberto.nome}</span>
                  <a className="text-slate-500 underline decoration-dotted hover:text-indigo-600 dark:hover:text-indigo-400" href={`/api/pdfs/${pdfAberto.pdf_id}/arquivo`} target="_blank" rel="noreferrer">abrir em nova aba</a>
                  <button type="button" className="ml-auto text-slate-500 hover:text-slate-700" onClick={() => setPdfAberto(null)}>fechar</button>
                </div>
                <VisualizadorPdf key={pdfAberto.pdf_id} pdfId={pdfAberto.pdf_id} paginaAlvo={pdfAberto.pagina} termo={pdfAberto.termo} sinalIrPara={sinalIrPara} />
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center">
                <div>
                  <IconeRabisco tipo="lupa" tamanho={44} className="mx-auto -rotate-6 text-slate-900 dark:text-slate-200" />
                  <p className="mt-3 font-serif text-[15px] text-slate-600 dark:text-slate-400">Busque um trecho (nº do documento, CPF, nome…) e abra o PDF aqui.</p>
                  <p className="mt-1 text-xs text-slate-500">A lupa ao lado de cada valor da amostra procura esse valor nas formas em que costuma estar impresso.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <DialogoPdfs aberto={dialogo === 'pdfs'} baseId={baseId} onFechar={() => setDialogo(null)} onMudou={carregarBase} onAbrir={(p) => { setDialogo(null); setModo('bater'); abrirPdf(p.id, 1, null, p.nome_arquivo); }} />
      <DialogoExportar aberto={dialogo === 'exportar'} base={base} preBates={pendencias.filter((l) => l.pre_bate).length} onFechar={() => setDialogo(null)} onSalvo={carregarBase} />
    </div>
  );
}
