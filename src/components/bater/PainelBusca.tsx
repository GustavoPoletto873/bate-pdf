'use client';

import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { FileText, Link2, Loader2, Search, X } from 'lucide-react';
import { api, ErroApi } from '@/lib/cliente';
import type { ResultadoBusca } from '@/lib/repo';
import { Botao, cx } from '@/components/ui';

/** O pai dispara buscas (clique num campo, "Buscar nº") por aqui. */
export type ControleBusca = { buscar: (termos: string[], rotulo?: string) => void };

/**
 * Busca "tipo grep" no texto dos PDFs da base: um resultado por PDF, com o
 * trecho em volta. Quando vem de um campo, tenta as formas de impressão do
 * valor em ordem até uma achar.
 */
export function PainelBusca({ ref, baseId, pdfAbertoId, podeVincular, onAbrir, onVincular }: {
  ref?: Ref<ControleBusca>;
  baseId: string;
  pdfAbertoId: number | null;
  podeVincular: boolean;
  onAbrir: (r: ResultadoBusca, termo: string) => void;
  onVincular: (r: ResultadoBusca) => void;
}) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusca[] | null>(null);
  const [usado, setUsado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [recolhido, setRecolhido] = useState(false);
  const seqRef = useRef(0);

  async function buscar(termos: string[], rotulo?: string) {
    const seq = ++seqRef.current;
    const lista = termos.map((t) => t.trim()).filter(Boolean);
    if (!lista.length) return;
    setTexto(lista[0]);
    setCarregando(true);
    setAviso(null);
    setRecolhido(false);
    try {
      for (const termo of lista) {
        const r = await api.buscar(baseId, termo);
        if (seq !== seqRef.current) return;
        if (r.motivo === 'termo_curto') {
          setAviso('Digite ao menos 3 caracteres.');
          setResultados(null);
          return;
        }
        if (r.resultados.length || termo === lista[lista.length - 1]) {
          setResultados(r.resultados);
          setUsado(termo);
          setTexto(termo);
          if (!r.resultados.length) {
            setAviso(`${rotulo ? `${rotulo}: ` : ''}nada nos ${r.total_pdfs} PDFs com texto${lista.length > 1 ? ` (tentei ${lista.length} formas: ${lista.join(' · ')})` : ''}. PDF escaneado sem texto não aparece na busca.`);
          } else if (lista.length > 1 && termo !== lista[0]) {
            setAviso(`Achado na forma "${termo}".`);
          }
          if (r.resultados.length === 1) onAbrir(r.resultados[0], termo);
          return;
        }
      }
    } catch (e) {
      setAviso(e instanceof ErroApi ? e.message : 'Falha na busca.');
    } finally {
      if (seq === seqRef.current) setCarregando(false);
    }
  }

  useImperativeHandle(ref, () => ({ buscar }));

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col border-b border-slate-200 dark:border-slate-800">
      <form className="flex items-center gap-2 p-2" onSubmit={(e) => { e.preventDefault(); buscar([texto]); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar nos PDFs da base (nº, CPF, nome, valor…)"
            className="lastro-campo h-8 w-full pl-8 pr-8 text-sm"
          />
          {texto && (
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => { setTexto(''); setResultados(null); setAviso(null); setUsado(null); }} aria-label="Limpar busca">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Botao type="submit" tamanho="sm" variante="primario" disabled={carregando}>{carregando ? <Loader2 className="size-3.5 animate-spin" /> : 'Buscar'}</Botao>
      </form>
      {aviso && <p className="px-3 pb-1 text-xs text-slate-500">{aviso}</p>}
      {resultados && resultados.length > 0 && (
        <>
          <button type="button" className="px-3 pb-1 text-left text-xs text-slate-500 hover:text-slate-700" onClick={() => setRecolhido((r) => !r)}>
            {resultados.length} PDF(s) com “{usado}” {recolhido ? '▸ mostrar' : '▾'}
          </button>
          {!recolhido && (
            <ul className="rolagem-fina min-h-0 flex-1 overflow-auto px-2 pb-2">
              {resultados.map((r) => (
                <li
                  key={r.pdf_id}
                  className={cx(
                    'group mb-1 cursor-pointer rounded-md border px-2 py-1.5 text-xs',
                    r.pdf_id === pdfAbertoId ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500/60 dark:bg-indigo-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700',
                  )}
                  onClick={() => onAbrir(r, usado ?? texto)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-slate-400" />
                    <span className="truncate font-medium" title={r.nome_arquivo}>{r.nome_arquivo}</span>
                    <span className="shrink-0 text-slate-500">pág. {r.pagina}{r.paginas_com_termo > 1 ? ` (+${r.paginas_com_termo - 1})` : ''}</span>
                    {r.vinculos > 0 && <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" title="Este PDF já tem vínculos">{r.vinculos} vínc.</span>}
                    {podeVincular && (
                      <button
                        type="button"
                        className="ml-auto hidden shrink-0 items-center gap-1 rounded bg-indigo-600 px-1.5 py-0.5 text-[11px] text-white group-hover:flex"
                        onClick={(e) => { e.stopPropagation(); onVincular(r); }}
                        title="Vincular a(s) pendência(s) selecionada(s) a este PDF"
                      >
                        <Link2 className="size-3" /> Vincular
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-slate-600 dark:text-slate-400">
                    {r.trecho.slice(0, r.destaque[0])}
                    <mark className="rounded bg-yellow-200 px-0.5 text-slate-900 dark:bg-yellow-500/40 dark:text-yellow-50">{r.trecho.slice(r.destaque[0], r.destaque[1])}</mark>
                    {r.trecho.slice(r.destaque[1])}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
