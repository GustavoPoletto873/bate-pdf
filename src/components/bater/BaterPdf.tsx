'use client';

import Link from 'next/link';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronsLeft, ChevronsRight, Copy, Download, Eye, FileStack, Link2, Loader2, Maximize2, Minimize2, RefreshCw, Search, Square, SquareCheck, X, Zap } from 'lucide-react';
import { api, ErroApi, type ResultadoPreClassificacaoTela, type SugestaoTitulo } from '@/lib/cliente';
import type { BaseResumo, OperacaoMarcacao, PendenciaLinha, ResultadoBusca } from '@/lib/repo';
import { camposDoLado, type CampoId, type Veredito } from '@/lib/campos';
import { normalizarTexto } from '@/lib/texto';
import { Aviso, Botao, cx, Etiqueta } from '@/components/ui';
import { IconeRabisco } from '@/components/rabiscos';
import { TabelaPendencias } from '@/components/bater/TabelaPendencias';
import { termosDeBusca } from '@/lib/busca';
import { DetalhePendencia, type PdfAberto } from '@/components/bater/DetalhePendencia';
import { PainelBusca, type ControleBusca } from '@/components/bater/PainelBusca';
import { VisualizadorPdf } from '@/components/pdf/VisualizadorPdf';
import { DialogoPdfs } from '@/components/bater/DialogoPdfs';
import { DialogoExportar } from '@/components/bater/DialogoExportar';
import { Conferencia } from '@/components/bater/Conferencia';
import { planejarMarcacoesSugeridas, ROTULO_CONFIANCA } from '@/components/bater/preClassificacao';

type Filtro = { lado: 'todos' | 'termo' | 'lastro'; situacao: 'pendente' | 'vinculado' | 'todas'; texto: string; sugestao: 'todas' | 'com' | 'sem' };
const LARGURA_PADRAO = 50;
const CHAVE_LARGURA = 'lastro-bater-largura-busca';

type Mensagem = { tipo: 'ok' | 'erro' | 'alerta' | 'info'; texto: string } | null;

/**
 * Texto de busca de cada título, normalizado uma vez só (o filtro roda a cada tecla em bases de
 * milhares de linhas). Pela referência do título: marcar um campo não troca o título, então o
 * índice sobrevive às marcações; recarregar a lista traz títulos novos e o índice é refeito.
 */
const INDICE_BUSCA = new WeakMap<object, { texto: string; digitos: string }>();
function indiceDoTitulo(t: PendenciaLinha['titulo']) {
  let i = INDICE_BUSCA.get(t);
  if (!i) {
    i = {
      texto: normalizarTexto(`${t.numero_documento ?? ''} ${t.sacado_nome ?? ''} ${t.cedente_nome ?? ''}`),
      // Separados por espaço: um CPF não "continua" no CNPJ do cedente.
      digitos: `${(t.sacado_documento ?? '').replace(/\D/g, '')} ${(t.cedente_documento ?? '').replace(/\D/g, '')}`,
    };
    INDICE_BUSCA.set(t, i);
  }
  return i;
}

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
  const [selecaoMultipla, setSelecaoMultipla] = useState(false);
  const [recolhida, setRecolhida] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  // Divisão busca × pendências: lembrada neste navegador, como no Bate Lastro. (A tela só
  // aparece depois de carregar a base, então ler aqui não descasa com o HTML do servidor.)
  const [larguraBusca, setLarguraBusca] = useState(() => {
    try {
      const n = Number(typeof window === 'undefined' ? NaN : window.localStorage.getItem(CHAVE_LARGURA));
      return n >= 25 && n <= 75 ? n : LARGURA_PADRAO;
    } catch {
      return LARGURA_PADRAO;
    }
  });
  const areaRef = useRef<HTMLDivElement>(null);

  const mudarLargura = useCallback((n: number) => {
    const v = Math.min(75, Math.max(25, Math.round(n)));
    setLarguraBusca(v);
    try { window.localStorage.setItem(CHAVE_LARGURA, String(v)); } catch { /* ignora */ }
  }, []);
  const iniciarArraste = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const area = areaRef.current;
    if (!area) return;
    const mover = (ev: MouseEvent) => {
      const r = area.getBoundingClientRect();
      mudarLargura(((ev.clientX - r.left) / r.width) * 100);
    };
    const soltar = () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  }, [mudarLargura]);

  // Esc sai da tela cheia.
  useEffect(() => {
    if (!telaCheia) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setTelaCheia(false); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [telaCheia]);

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

  // A busca digitada é "adiada": a caixa de texto responde na hora e a lista filtra logo em seguida.
  const textoBusca = useDeferredValue(filtro.texto);
  const filtradas = useMemo(() => {
    const alvo = normalizarTexto(textoBusca.trim());
    const digitosAlvo = textoBusca.replace(/\D/g, '');
    return (pendencias ?? []).filter((l) => {
      if (filtro.lado !== 'todos' && l.lado !== filtro.lado) return false;
      if (filtro.situacao === 'pendente' && l.situacao !== 'pendente') return false;
      if (filtro.situacao === 'vinculado' && l.situacao === 'pendente') return false;
      if (filtro.sugestao !== 'todas') {
        const tem = Boolean(sugestoes[l.titulo_id]?.candidatos?.[l.lado]);
        if ((filtro.sugestao === 'com') !== tem) return false;
      }
      if (!alvo) return true;
      const i = indiceDoTitulo(l.titulo);
      return i.texto.includes(alvo) || (digitosAlvo.length >= 3 && i.digitos.includes(digitosAlvo));
    });
  }, [pendencias, filtro.lado, filtro.situacao, filtro.sugestao, textoBusca, sugestoes]);

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
  const resumoPre = pre?.resultado.resumo;
  const aplicaveis = resumoPre ? (resumoPre.alta ?? 0) + (resumoPre.media ?? 0) : 0;

  const aplicarSugestoes = () => {
    if (!pre || !pendencias) return;
    const ops = pre.resultado.resultados
      .filter((s) => s.candidatos && Object.values(s.candidatos).some((c) => c && ['alta', 'media'].includes(String(c.confianca))))
      .flatMap((s) => planejarMarcacoesSugeridas(s, pendencias));
    if (!ops.length) {
      avisar('info', 'Nada a aplicar: os campos sugeridos com confiança alta ou média já foram decididos.');
      return;
    }
    marcar(ops);
    avisar('ok', `${ops.length} marcação(ões) sugerida(s) gravada(s). Campos que alguém já tinha decidido ficaram como estavam.`);
  };

  const botaoIcone = 'rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20';

  const painelPendencias = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="whitespace-nowrap font-display text-base tracking-tight" title="Clique numa linha para conferir os campos; use “Buscar” para achar o documento nos PDFs.">
          O que ainda falta resolver
          <span className="ml-2 font-sans text-xs font-normal text-slate-500 dark:text-slate-400">· {base.pendentes.termo} termo(s) · {base.pendentes.lastro} lastro(s)</span>
        </h3>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {copiada && (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 dark:border-emerald-400/30 dark:bg-emerald-500/10">
              <span className="whitespace-nowrap text-xs text-emerald-700 dark:text-emerald-300">Marcação copiada</span>
              <button type="button" onClick={colarMarcacoes} disabled={!selecionadas.size} className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40" title={selecionadas.size ? `Aplicar nas ${selecionadas.size} linha(s) selecionada(s)` : 'Ative a seleção múltipla e marque as linhas de destino'}>
                Colar{selecionadas.size ? ` (${selecionadas.size})` : ''}
              </button>
              <button type="button" onClick={() => setCopiada(null)} className="text-emerald-700 dark:text-emerald-300" title="Cancelar a cópia"><X className="size-3.5" /></button>
            </div>
          )}
          <button
            type="button"
            onClick={() => { setSelecaoMultipla((s) => !s); if (selecaoMultipla) setSelecionadas(new Set()); }}
            className={cx('relative rounded-lg p-1.5 transition-colors', selecaoMultipla ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20')}
            title={selecaoMultipla ? `Seleção múltipla ativa — ${selecionadas.size} linha(s) marcada(s)` : 'Selecionar várias pendências para vincular juntas ou colar uma marcação copiada'}
          >
            {selecaoMultipla ? <SquareCheck className="size-4" /> : <Square className="size-4" />}
            {selecaoMultipla && selecionadas.size > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-indigo-700 shadow">{selecionadas.size}</span>}
          </button>
          <button type="button" className={botaoIcone} title="Recarregar" onClick={() => { carregarPendencias(); carregarBase(); }}><RefreshCw className="size-4" /></button>
          <button type="button" className={botaoIcone} title="Recolher esta tabela e dar a largura toda para o PDF" onClick={() => setRecolhida(true)}><ChevronsRight className="size-4" /></button>
        </div>
      </div>

      {/* Faixa da pré-classificação (BarraPreClassificacao do Bate Lastro). */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-violet-200/70 bg-violet-50/70 px-3 py-2 dark:border-violet-400/30 dark:bg-violet-500/10">
        <button type="button" onClick={preClassificar} disabled={preRodando || base.pdfs.indexados === 0} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50" title={base.pdfs.indexados === 0 ? 'Envie e indexe os PDFs primeiro' : 'Procura cada pendência no texto de todos os PDFs da base e sugere o PDF certo e o V/D/P de cada campo. Não grava nada sozinho.'}>
          {preRodando ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          {preRodando ? 'Analisando PDFs…' : pre ? 'Pré-classificar de novo' : 'Pré-classificar pendências'}
        </button>
        {resumoPre && pre ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {(['alta', 'media', 'baixa', 'ambigua'] as const).map((c) => (
                <Etiqueta key={c} cor={ROTULO_CONFIANCA[c].cor}>{resumoPre[c] ?? 0} {ROTULO_CONFIANCA[c].texto.toLowerCase()}</Etiqueta>
              ))}
              <span className="text-slate-500 dark:text-slate-400">· {resumoPre.sem_candidato ?? 0} sem PDF · {pre.resultado.pdfs_analisados} PDF(s) lidos</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => setModo('conferencia')} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700" title="Conferência em lote: cada pendência com o recorte do PDF onde os valores foram achados, sem abrir PDF por PDF.">
                <Eye className="size-3.5" /> Conferir
              </button>
              <button type="button" onClick={aplicarSugestoes} disabled={!aplicaveis || ocupado} className="flex items-center gap-1.5 rounded-lg border border-violet-300/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-400/40 dark:bg-white/10 dark:text-violet-200 dark:hover:bg-violet-500/20" title="Grava os V e D sugeridos com confiança alta ou média. Campo que alguém já marcou não é tocado.">
                <Check className="size-3.5" /> Aplicar marcações
              </button>
            </div>
          </>
        ) : (
          <span className="text-[11px] text-violet-900/80 dark:text-violet-200/80">Sugere o PDF e o V/D/P de cada campo. Você confere antes de gravar.</span>
        )}
      </div>

      {/* Filtros: tipo (chips), busca e situação. */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex gap-1.5">
          {([['todos', 'Todos'], ['termo', 'Termo'], ['lastro', 'Lastro']] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" onClick={() => setFiltro({ ...filtro, lado: valor })} className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors', filtro.lado === valor ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20')}>
              {rotulo}
            </button>
          ))}
        </div>
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input className="lastro-campo h-8 w-full pl-9 pr-8 text-sm" placeholder="Buscar por documento, sacado, CPF/CNPJ…" value={filtro.texto} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
          {filtro.texto && <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setFiltro({ ...filtro, texto: '' })} aria-label="Limpar"><X className="size-4" /></button>}
        </div>
        <select className="lastro-campo h-8 px-2 text-xs" value={filtro.situacao} onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value as Filtro['situacao'] })} aria-label="Situação">
          <option value="pendente">Pendentes</option><option value="vinculado">Batidos</option><option value="todas">Todas</option>
        </select>
        {pre && (
          <select className="lastro-campo h-8 px-2 text-xs" value={filtro.sugestao} onChange={(e) => setFiltro({ ...filtro, sugestao: e.target.value as Filtro['sugestao'] })} aria-label="Sugestão">
            <option value="todas">Com e sem PDF sugerido</option><option value="com">Com PDF sugerido</option><option value="sem">Sem PDF sugerido</option>
          </select>
        )}
      </div>

      {selecaoMultipla && selecionadas.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
          <span className="font-semibold">{selecionadas.size} selecionada(s)</span>
          <Botao tamanho="sm" variante="primario" disabled={!pdfAberto || ocupado || !alvoVinculo.length} onClick={() => pdfAberto && vincular(pdfAberto.pdf_id, pdfAberto.pagina)} title={pdfAberto ? `Vincular as selecionadas a ${pdfAberto.nome}` : 'Abra um PDF à esquerda'}>
            <Link2 className="size-3.5" /> Vincular {alvoVinculo.length} ao PDF aberto
          </Botao>
          <button type="button" className="ml-auto text-slate-500 hover:text-slate-700 dark:hover:text-slate-300" onClick={() => setSelecionadas(new Set())}>limpar seleção</button>
        </div>
      )}

      <div className={cx('flex min-h-0 flex-col', linhaAtiva ? 'flex-[1_1_42%]' : 'flex-1')}>
        <TabelaPendencias
          linhas={filtradas}
          ativa={ativa}
          selecionadas={selecionadas}
          selecaoMultipla={selecaoMultipla}
          sugestoes={sugestoes}
          onAtivar={setAtiva}
          onAlternarSelecao={alternarSelecao}
          onSelecionarTodas={(m) => setSelecionadas(m ? new Set(filtradas.map((l) => l.pendencia_id)) : new Set())}
          onBuscar={(l) => buscaRef.current?.buscar(termosDeBusca('numero_documento', l.titulo.numero_documento), 'Nº do documento')}
        />
        <p className="mt-1 shrink-0 text-[11px] text-slate-500">{filtradas.length.toLocaleString('pt-BR')} linha(s) no filtro · ↑/↓ navega · clique numa linha para conferir os campos</p>
      </div>

      {linhaAtiva && (
        <div className="mt-2 flex min-h-0 flex-[1_1_58%] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
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
          <div className="flex shrink-0 gap-3 border-t border-slate-200 px-3 py-1 text-[11px] text-slate-500 dark:border-slate-800">
            {linhaAtiva.situacao === 'pendente' && <button type="button" className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300" onClick={copiarMarcacoes}><Copy className="size-3" /> copiar marcações desta linha</button>}
            <button type="button" className="ml-auto hover:text-slate-700 dark:hover:text-slate-300" onClick={() => setAtiva(null)}>fechar detalhe</button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={cx('flex min-h-0 flex-1 flex-col bg-[var(--lastro-fundo)]', telaCheia && 'fixed inset-0 z-40')}>
      {/* Cabeçalho enxuto, como o do modal do Bate Lastro: a tela é PDF + tabela. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-slate-200 px-5 py-2.5 dark:border-slate-800">
        {modo === 'conferencia' ? (
          <button type="button" onClick={() => setModo('bater')} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700" title="Voltar para a tabela de pendências">
            <ArrowLeft className="size-4" /> Voltar para o Bater PDF
          </button>
        ) : (
          <Link href={`/pre-matches?base=${baseId}`} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-slate-200" title="Voltar para a Gestão de Bates"><ArrowLeft className="size-4" /></Link>
        )}
        <IconeRabisco tipo="pdf" tamanho={22} className="shrink-0 text-slate-900 dark:text-slate-200" />
        <h1 className="font-display text-base tracking-tight">{modo === 'conferencia' ? 'Conferir pré-classificação' : 'Bater PDF'}</h1>
        <span className="hidden text-xs text-slate-500 md:inline dark:text-slate-400">
          {modo === 'conferencia' ? '— os títulos agrupados pelo que a leitura achou' : '— busque um termo em todos os PDFs pendentes desta base'}
        </span>
        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block dark:bg-slate-700" />
        <span className="max-w-[28ch] truncate text-sm font-semibold" title={base.nome}>{base.nome}</span>
        <Etiqueta cor={pendentesTotal ? 'amber' : 'emerald'}>{pendentesTotal} pendentes</Etiqueta>
        <Etiqueta cor="emerald">{batidos} batidos aqui</Etiqueta>
        <button type="button" onClick={() => setDialogo('pdfs')}>
          <Etiqueta cor="sky" titulo="Ver e enviar PDFs">
            {(indexando || base.pdfs.pendentes > 0) && <Loader2 className="size-3 animate-spin" />}
            {base.pdfs.indexados}/{base.pdfs.total} PDFs com texto
          </Etiqueta>
        </button>
        {base.pdfs.sem_texto > 0 && <Etiqueta cor="orange" titulo="Escaneados, sem camada de texto: não entram na busca nem na pré-classificação">{base.pdfs.sem_texto} sem texto</Etiqueta>}
        <div className="ml-auto flex items-center gap-2">
          <Botao tamanho="sm" onClick={() => setDialogo('pdfs')}><FileStack className="size-3.5" /> PDFs</Botao>
          <Botao tamanho="sm" variante="primario" onClick={() => setDialogo('exportar')}><Download className="size-3.5" /> Exportar p/ Bate Lastro</Botao>
          <button type="button" className={botaoIcone} onClick={() => setTelaCheia((t) => !t)} title={telaCheia ? 'Sair da tela cheia' : 'Tela cheia (esconde o menu)'}>
            {telaCheia ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </div>
      </div>

      {mensagem && (
        <div className="shrink-0 px-4 pt-2">
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
        <div ref={areaRef} className="flex min-h-0 flex-1 p-4">
          {/* Esquerda: busca nos PDFs + o PDF aberto (BuscaPdfPanel do Bate Lastro). */}
          <section
            className={cx('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950', recolhida ? 'min-w-0 flex-1' : 'shrink-0')}
            style={recolhida ? undefined : { width: `${larguraBusca}%` }}
          >
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
                  {linhaAtiva?.situacao === 'pendente' && !selecaoMultipla && (
                    <Botao tamanho="sm" variante="primario" disabled={ocupado} onClick={() => vincular(pdfAberto.pdf_id, pdfAberto.pagina, [linhaAtiva])} title={`Vincular o ${linhaAtiva.lado === 'termo' ? 'Termo' : 'Lastro'} do doc ${linhaAtiva.titulo.numero_documento ?? ''} a este PDF`}>
                      <Link2 className="size-3.5" /> Vincular doc {linhaAtiva.titulo.numero_documento}
                    </Botao>
                  )}
                  <a className="ml-auto text-slate-500 underline decoration-dotted hover:text-indigo-600 dark:hover:text-indigo-400" href={`/api/pdfs/${pdfAberto.pdf_id}/arquivo`} target="_blank" rel="noreferrer">nova aba</a>
                  <button type="button" className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300" onClick={() => setPdfAberto(null)}>fechar</button>
                </div>
                <VisualizadorPdf key={pdfAberto.pdf_id} pdfId={pdfAberto.pdf_id} paginaAlvo={pdfAberto.pagina} termo={pdfAberto.termo} sinalIrPara={sinalIrPara} />
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center">
                <div>
                  <IconeRabisco tipo="lupa" tamanho={44} className="mx-auto -rotate-6 text-slate-900 dark:text-slate-200" />
                  <p className="mt-3 font-serif text-[15px] text-slate-600 dark:text-slate-400">Busque um número, nome ou valor em todos os PDFs da base.</p>
                  <p className="mt-1 text-xs text-slate-500">Ou clique em “Buscar” numa pendência da tabela: o nº do documento é procurado nas formas em que costuma estar impresso.</p>
                </div>
              </div>
            )}
          </section>

          {recolhida ? (
            <button type="button" onClick={() => setRecolhida(false)} className="ml-4 flex w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:bg-black/20 dark:text-slate-400 dark:hover:bg-white/10" title="Mostrar a tabela de pendências de novo">
              <ChevronsLeft className="size-4" />
              <span className="rotate-180 text-[10px] font-semibold tracking-wide [writing-mode:vertical-rl]">Pendências</span>
            </button>
          ) : (
            <>
              <div
                onMouseDown={iniciarArraste}
                onDoubleClick={() => mudarLargura(LARGURA_PADRAO)}
                className="group mx-1 flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                title="Arraste para ajustar a divisão entre busca e pendências (duplo clique volta ao padrão)"
              >
                <div className="h-16 w-1 rounded-full bg-slate-300/70 transition-colors group-hover:bg-indigo-400 dark:bg-white/20 dark:group-hover:bg-indigo-500" />
              </div>
              <section className="min-h-0 min-w-[340px] flex-1">{painelPendencias}</section>
            </>
          )}
        </div>
      )}

      <DialogoPdfs aberto={dialogo === 'pdfs'} baseId={baseId} onFechar={() => setDialogo(null)} onMudou={carregarBase} onAbrir={(p) => { setDialogo(null); setModo('bater'); abrirPdf(p.id, 1, null, p.nome_arquivo); }} />
      <DialogoExportar aberto={dialogo === 'exportar'} base={base} preBates={pendencias.filter((l) => l.pre_bate).length} onFechar={() => setDialogo(null)} onSalvo={carregarBase} />
    </div>
  );
}
