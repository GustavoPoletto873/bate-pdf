'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ChevronDown, ChevronUp, Loader2, Minus, Plus } from 'lucide-react';
import { abrirDocumento, carregarPdfjs, type CaixaNormalizada } from '@/components/pdf/pdfjs';
import { cx } from '@/components/ui';

/**
 * Visualizador embutido: todas as páginas em rolagem, renderizadas sob demanda,
 * com camada de texto (dá para selecionar e copiar) e destaque do termo
 * buscado. O destaque vem do servidor em coordenadas normalizadas (PDFium, o
 * mesmo índice de caracteres do texto indexado), então fica alinhado em
 * qualquer zoom — como no Bate Lastro.
 */
export function VisualizadorPdf({ pdfId, paginaAlvo, termo, destaquesExtras, sinalIrPara }: {
  pdfId: number;
  paginaAlvo?: number | null;
  termo?: string | null;
  /** Caixas extras por página (evidências da pré-classificação). */
  destaquesExtras?: Record<number, CaixaNormalizada[]>;
  /** Muda para forçar rolar até `paginaAlvo` de novo. */
  sinalIrPara?: number;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [proporcao, setProporcao] = useState(1.414);
  const [largura, setLargura] = useState(0);
  const [zoom, setZoom] = useState(1);
  // Ocorrências guardadas com a chave da busca: trocar o termo não precisa limpar nada.
  const [achado, setAchado] = useState<{ chave: string; paginas: Record<number, CaixaNormalizada[]> }>({ chave: '', paginas: {} });
  const [paginaAtual, setPaginaAtual] = useState(1);
  const rolagemRef = useRef<HTMLDivElement>(null);
  const alvoBusca = (termo ?? '').trim();
  const chaveBusca = `${pdfId}|${alvoBusca}`;
  const ocorrencias = useMemo(() => (achado.chave === chaveBusca ? achado.paginas : {}), [achado, chaveBusca]);
  const elementoDaPagina = (n: number) => rolagemRef.current?.querySelector<HTMLElement>(`[data-pagina="${n}"]`) ?? null;

  // O pai troca a `key` quando muda o PDF: o estado nasce limpo a cada documento.
  useEffect(() => {
    let vivo = true;
    abrirDocumento(pdfId)
      .then(async (d) => {
        const p1 = await d.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        if (!vivo) return;
        setProporcao(vp.height / vp.width);
        setDoc(d);
      })
      .catch(() => vivo && setErro('Não foi possível abrir este PDF no visualizador.'));
    return () => { vivo = false; };
  }, [pdfId]);

  useEffect(() => {
    const el = rolagemRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLargura(el.clientWidth - 24));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (alvoBusca.length < 3) return;
    const ctrl = new AbortController();
    fetch(`/api/pdfs/${pdfId}/ocorrencias?q=${encodeURIComponent(alvoBusca)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((r: { paginas?: { pagina: number; caixas: CaixaNormalizada[] }[] }) => {
        setAchado({ chave: `${pdfId}|${alvoBusca}`, paginas: Object.fromEntries((r.paginas ?? []).map((p) => [p.pagina, p.caixas])) });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [pdfId, alvoBusca]);

  // Rola até a página pedida quando o documento abre ou o alvo muda.
  useEffect(() => {
    if (!doc || !paginaAlvo) return;
    const t = setTimeout(() => {
      rolagemRef.current?.querySelector<HTMLElement>(`[data-pagina="${paginaAlvo}"]`)?.scrollIntoView({ block: 'start' });
    }, 30);
    return () => clearTimeout(t);
  }, [doc, paginaAlvo, sinalIrPara]);

  const paginasComTermo = useMemo(() => Object.keys(ocorrencias).map(Number).sort((a, b) => a - b), [ocorrencias]);

  const irPara = (n: number) => elementoDaPagina(n)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const proximaOcorrencia = (dir: 1 | -1) => {
    const alvo = dir === 1 ? paginasComTermo.find((p) => p > paginaAtual) : [...paginasComTermo].reverse().find((p) => p < paginaAtual);
    if (alvo) irPara(alvo);
  };

  const larguraPagina = Math.max(200, largura * zoom);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 px-2 text-xs dark:border-slate-800">
        <span className="text-slate-500">Pág. {paginaAtual}{doc ? ` / ${doc.numPages}` : ''}</span>
        {paginasComTermo.length > 0 && (
          <span className="flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-900 dark:bg-yellow-500/20 dark:text-yellow-200">
            termo em {paginasComTermo.length} pág.
            <button type="button" className="rounded p-0.5 hover:bg-yellow-200 dark:hover:bg-yellow-500/30" onClick={() => proximaOcorrencia(-1)} title="Ocorrência anterior"><ChevronUp className="size-3.5" /></button>
            <button type="button" className="rounded p-0.5 hover:bg-yellow-200 dark:hover:bg-yellow-500/30" onClick={() => proximaOcorrencia(1)} title="Próxima ocorrência"><ChevronDown className="size-3.5" /></button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} title="Diminuir"><Minus className="size-3.5" /></button>
          <button type="button" className="w-12 rounded py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom(1)} title="Ajustar à largura">{Math.round(zoom * 100)}%</button>
          <button type="button" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} title="Aumentar"><Plus className="size-3.5" /></button>
        </div>
      </div>
      <div ref={rolagemRef} className="rolagem-fina min-h-0 flex-1 overflow-auto bg-slate-200/70 p-3 dark:bg-slate-950">
        {erro && <p className="p-4 text-sm text-rose-600">{erro}</p>}
        {!doc && !erro && <p className="flex items-center gap-2 p-4 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Abrindo PDF…</p>}
        {doc && largura > 0 && Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
          <PaginaPdf
            key={`${pdfId}-${n}`}
            doc={doc}
            numero={n}
            larguraCss={larguraPagina}
            proporcaoPadrao={proporcao}
            caixas={ocorrencias[n]}
            extras={destaquesExtras?.[n]}
            raiz={rolagemRef}
            onVisivel={setPaginaAtual}
          />
        ))}
      </div>
    </div>
  );
}

function PaginaPdf({ doc, numero, larguraCss, proporcaoPadrao, caixas, extras, raiz, onVisivel }: {
  doc: PDFDocumentProxy;
  numero: number;
  larguraCss: number;
  proporcaoPadrao: number;
  caixas?: CaixaNormalizada[];
  extras?: CaixaNormalizada[];
  raiz: React.RefObject<HTMLDivElement | null>;
  onVisivel: (numero: number) => void;
}) {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textoRef = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [proporcao, setProporcao] = useState(proporcaoPadrao);
  // Escala da página (pt → px CSS): a camada de texto do pdf.js posiciona por ela.
  const [escalaTexto, setEscalaTexto] = useState(larguraCss / 612);
  const avisarVisivel = useEffectEvent(() => onVisivel(numero));

  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const perto = new IntersectionObserver(([e]) => setVisivel(e.isIntersecting), { root: raiz.current, rootMargin: '800px 0px' });
    const atual = new IntersectionObserver(([e]) => { if (e.isIntersecting) avisarVisivel(); }, { root: raiz.current, rootMargin: '-45% 0px -45% 0px' });
    perto.observe(el);
    atual.observe(el);
    return () => { perto.disconnect(); atual.disconnect(); };
  }, [raiz]);

  useEffect(() => {
    if (!visivel) return;
    let tarefa: RenderTask | null = null;
    let cancelado = false;
    let camada: { cancel: () => void } | null = null;
    (async () => {
      const pdfjs = await carregarPdfjs();
      const pagina = await doc.getPage(numero);
      if (cancelado) return;
      const base = pagina.getViewport({ scale: 1 });
      setProporcao(base.height / base.width);
      const escala = larguraCss / base.width;
      setEscalaTexto(escala);
      const vp = pagina.getViewport({ scale: escala });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      tarefa = pagina.render({ canvas, canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await tarefa.promise.catch(() => {});
      if (cancelado || !textoRef.current) return;
      textoRef.current.replaceChildren();
      const conteudo = await pagina.getTextContent();
      if (cancelado || !textoRef.current) return;
      const tl = new pdfjs.TextLayer({ textContentSource: conteudo, container: textoRef.current, viewport: vp });
      camada = tl;
      await tl.render().catch(() => {});
    })();
    return () => {
      cancelado = true;
      tarefa?.cancel();
      camada?.cancel();
    };
  }, [visivel, doc, numero, larguraCss]);

  const altura = larguraCss * proporcao;
  return (
    <div
      ref={caixaRef}
      className="relative mx-auto mb-3 bg-white shadow-sm"
      style={{ width: larguraCss, height: altura, ['--total-scale-factor' as string]: escalaTexto, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}
      data-pagina={numero}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={textoRef} className="textLayer" />
      {[...(caixas ?? []).map((c) => ({ ...c, tipo: 'busca' })), ...(extras ?? [])].map((c, i) => (
        <div
          key={i}
          className={cx(
            'pointer-events-none absolute z-[3] rounded-[2px] mix-blend-multiply',
            c.tipo === 'busca' && 'bg-yellow-300/70',
            c.tipo === 'V' && 'bg-emerald-300/60 ring-1 ring-emerald-600',
            c.tipo === 'D' && 'bg-amber-300/60 ring-1 ring-amber-600',
            c.tipo === 'regiao' && 'bg-sky-200/30 ring-1 ring-sky-400',
          )}
          style={{ left: `${c.x0 * 100}%`, top: `${c.y0 * 100}%`, width: `${(c.x1 - c.x0) * 100}%`, height: `${(c.y1 - c.y0) * 100}%` }}
        />
      ))}
      <span className="absolute bottom-1 right-2 z-[3] text-[10px] text-slate-400">{numero}</span>
    </div>
  );
}
