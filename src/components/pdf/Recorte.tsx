'use client';

import { useEffect, useRef, useState } from 'react';
import { abrirDocumento, type CaixaNormalizada } from '@/components/pdf/pdfjs';
import { cx } from '@/components/ui';

type Faixa = { y0: number; y1: number; caixas: CaixaNormalizada[] };

/** Agrupa as caixas em faixas horizontais da página (trechos próximos ficam na mesma faixa). */
function faixasDasCaixas(caixas: CaixaNormalizada[], margem = 0.012): Faixa[] {
  const ordenadas = [...caixas].sort((a, b) => a.y0 - b.y0);
  const faixas: Faixa[] = [];
  for (const c of ordenadas) {
    const ultima = faixas[faixas.length - 1];
    if (ultima && c.y0 - ultima.y1 < 0.05) {
      ultima.y1 = Math.max(ultima.y1, c.y1);
      ultima.caixas.push(c);
    } else faixas.push({ y0: c.y0, y1: c.y1, caixas: [c] });
  }
  return faixas.slice(0, 4).map((f) => ({ ...f, y0: Math.max(0, f.y0 - margem), y1: Math.min(1, f.y1 + margem) }));
}

/**
 * Recorte do PDF com os valores destacados (V verde, D âmbar, linha do título
 * em azul claro): só as faixas da página onde estão os trechos — dispensa
 * abrir o PDF para conferir. As caixas vêm do servidor (PDFium, mesmos índices
 * do texto que o motor leu); a página é desenhada aqui com o pdf.js.
 */
export function Recorte({ pdfId, pagina, trechos, regiao, onClick }: {
  pdfId: number; pagina: number; trechos: string; regiao?: string; onClick?: () => void;
}) {
  const [faixas, setFaixas] = useState<Faixa[] | null>(null);
  const [imagem, setImagem] = useState<{ url: string; largura: number; altura: number } | null>(null);
  const [erro, setErro] = useState(false);
  const [visivel, setVisivel] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisivel(true); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visivel) return;
    let vivo = true;
    const qs = new URLSearchParams({ pagina: String(pagina), trechos, regiao: regiao ?? '' });
    fetch(`/api/pdfs/${pdfId}/caixas?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(async (r: { caixas: CaixaNormalizada[] }) => {
        if (!vivo) return;
        const f = faixasDasCaixas(r.caixas.length ? r.caixas : [{ x0: 0, x1: 1, y0: 0, y1: 0.25 }]);
        setFaixas(f);
        const doc = await abrirDocumento(pdfId);
        const pg = await doc.getPage(pagina);
        const vp = pg.getViewport({ scale: 1100 / pg.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await pg.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        if (vivo) setImagem({ url: canvas.toDataURL('image/jpeg', 0.85), largura: canvas.width, altura: canvas.height });
      })
      .catch(() => vivo && setErro(true));
    return () => { vivo = false; };
  }, [visivel, pdfId, pagina, trechos, regiao]);

  return (
    <div ref={caixaRef} className={cx('space-y-1', onClick && 'cursor-zoom-in')} onClick={onClick} title={onClick ? 'Abrir no visualizador' : undefined}>
      {erro && <p className="text-[11px] text-slate-400">Não foi possível montar o recorte desta página.</p>}
      {!erro && (!faixas || !imagem) && <div className="h-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />}
      {faixas && imagem && faixas.map((f, i) => {
        const alturaFaixa = f.y1 - f.y0;
        return (
          <div key={i} className="relative w-full overflow-hidden rounded border border-slate-200 bg-white dark:border-slate-700" style={{ aspectRatio: `${imagem.largura} / ${imagem.altura * alturaFaixa}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagem.url} alt={`Página ${pagina}`} className="absolute left-0 w-full max-w-none" style={{ top: `${(-f.y0 / alturaFaixa) * 100}%`, height: `${100 / alturaFaixa}%` }} />
            {f.caixas.map((c, j) => (
              <div
                key={j}
                className={cx(
                  'absolute rounded-[2px] mix-blend-multiply',
                  c.tipo === 'V' && 'bg-emerald-300/60 ring-1 ring-emerald-600',
                  c.tipo === 'D' && 'bg-amber-300/70 ring-1 ring-amber-600',
                  c.tipo === 'regiao' && 'bg-sky-200/30',
                )}
                style={{
                  left: `${c.x0 * 100}%`, width: `${(c.x1 - c.x0) * 100}%`,
                  top: `${((c.y0 - f.y0) / alturaFaixa) * 100}%`, height: `${((c.y1 - c.y0) / alturaFaixa) * 100}%`,
                }}
              />
            ))}
          </div>
        );
      })}
      <p className="text-right text-[10px] text-slate-400">pág. {pagina}</p>
    </div>
  );
}
