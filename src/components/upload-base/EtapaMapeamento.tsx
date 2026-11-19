'use client';

import { useState } from 'react';
import { CheckCircle2, Eraser, Sparkles } from 'lucide-react';
import { COLUNAS_OBRIGATORIAS, DESCRICAO_COLUNA, type AnaliseArquivo, type ColunaUpload } from '@/lib/upload-base/colunas';
import { Botao, Etiqueta, cx } from '@/components/ui';

const obrigatoria = (c: string) => (COLUNAS_OBRIGATORIAS as string[]).includes(c);

/**
 * Mapeamento de colunas: um cartão por coluna do arquivo com o destino escolhido. Mapear nunca é
 * obrigatório para seguir, mas as 5 colunas obrigatórias vazias fazem o processamento recusar.
 */
export function EtapaMapeamento({ analise, arquivo, mapeamento, onChange, onVoltar, onProcessar, processando }: {
  analise: AnaliseArquivo;
  arquivo: string;
  mapeamento: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
  onVoltar: () => void;
  onProcessar: () => void;
  processando: boolean;
}) {
  const [resumo, setResumo] = useState(false);
  const usados = new Map(Object.entries(mapeamento).filter(([, d]) => d).map(([c, d]) => [d, c]));
  const naoMapeados = analise.colunas_padrao.filter((c) => !usados.has(c));
  const mapeadas = usados.size;

  // Cada destino vale para uma coluna só: escolher um destino já usado tira ele da outra coluna.
  function escolher(coluna: string, destino: string) {
    const novo: Record<string, string> = {};
    for (const c of analise.colunas_arquivo) novo[c] = mapeamento[c] === destino && destino ? '' : (mapeamento[c] ?? '');
    novo[coluna] = destino;
    onChange(novo);
  }
  const limpar = () => onChange(Object.fromEntries(analise.colunas_arquivo.map((c) => [c, ''])));
  const sugestoes = () => onChange(Object.fromEntries(analise.colunas_arquivo.map((c) => [c, analise.sugestoes_mapeamento[c] ?? ''])));
  const exemplo = (coluna: string) => analise.exemplo.map((l) => l[coluna]).find(Boolean);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg tracking-tight">Mapeamento de colunas</h2>
        <div className="flex flex-wrap gap-2">
          <Botao tamanho="sm" onClick={sugestoes} title="Aplicar sugestões automáticas"><Sparkles className="size-3.5" /> Aplicar sugestões automáticas</Botao>
          <Botao tamanho="sm" onClick={limpar} title="Limpar todos os mapeamentos"><Eraser className="size-3.5" /> Limpar todos os mapeamentos</Botao>
          <Botao tamanho="sm" variante="fantasma" onClick={() => setResumo((v) => !v)}>{resumo ? 'Ocultar' : 'Ver'} Resumo</Botao>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm dark:border-slate-700">
        <span><b>Arquivo:</b> {arquivo}{analise.aba && analise.aba !== 'CSV' ? ` (aba ${analise.aba})` : ''}</span>
        <span><b>Linhas:</b> {analise.total_linhas}</span>
        <span><b>Mapeamentos:</b> {mapeadas}</span>
        {analise.colunas_vencimento.length > 1 && (
          <p className="w-full text-xs text-slate-600 dark:text-slate-400">
            <b>Vencimento:</b> vale a coluna que você escolher abaixo. Nas linhas em que ela estiver vazia, o sistema usa a outra coluna de vencimento do arquivo
            ({analise.colunas_vencimento.join(' / ')}).
          </p>
        )}
      </div>

      {naoMapeados.length > 0 && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <p className="font-medium">Colunas DESTINO não mapeadas ({naoMapeados.length})</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {naoMapeados.map((c) => <Etiqueta key={c} cor={obrigatoria(c) ? 'amber' : 'sky'} titulo={DESCRICAO_COLUNA[c as ColunaUpload]}>{c}{obrigatoria(c) ? ' · obrigatória' : ''}</Etiqueta>)}
          </div>
          <p className="mt-2 text-xs">
            Você pode mapear estes campos ou seguir com o mapeamento atual.
            {naoMapeados.some(obrigatoria) && ' As obrigatórias sem coluna fazem o processamento recusar a planilha (o Bate Lastro exige cedente, sacado, documentos e nº do documento).'}
          </p>
        </div>
      )}

      {resumo && (
        <div className="mb-4 overflow-x-auto rounded-xl border-2 border-slate-900 p-4 dark:border-slate-200">
          <div className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[['Colunas origem', analise.colunas_arquivo.length], ['Mapeadas', mapeadas], ['Destinos disponíveis', analise.colunas_padrao.length], ['Destinos livres', naoMapeados.length]].map(([r, v]) => (
              <div key={r} className="rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-900"><p className="font-display text-xl tabular-nums">{v}</p><p className="text-xs text-slate-500 dark:text-slate-400">{r}</p></div>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-300 text-left dark:border-slate-700"><th className="lastro-rotulo py-1.5">Coluna origem</th><th className="lastro-rotulo py-1.5">Campo destino</th><th className="lastro-rotulo py-1.5">Situação</th></tr></thead>
            <tbody>
              {analise.colunas_arquivo.map((c) => (
                <tr key={c} className="border-b border-dashed border-slate-200 dark:border-slate-800">
                  <td className="py-1.5 font-medium">{c}</td>
                  <td className="py-1.5">{mapeamento[c] || <span className="italic text-slate-400 dark:text-slate-500">Não mapeado</span>}</td>
                  <td className="py-1.5">{mapeamento[c] ? <Etiqueta cor="emerald">Mapeada</Etiqueta> : <Etiqueta>Opcional</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rolagem-fina mb-6 grid max-h-[28rem] gap-3 overflow-y-auto p-1 lg:grid-cols-2">
        {analise.colunas_arquivo.map((coluna) => {
          const destino = mapeamento[coluna] ?? '';
          const ex = exemplo(coluna);
          return (
            <div key={coluna} className={cx('rounded-xl border-2 p-3', destino ? 'border-slate-900 dark:border-slate-200' : 'border-dashed border-slate-300 dark:border-slate-700')}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Origem</p>
                  <p className="truncate font-semibold" title={coluna}>{coluna}</p>
                  {ex && <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={ex}>ex.: {ex}</p>}
                </div>
                {destino && <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
              </div>
              <select aria-label={`Destino da coluna ${coluna}`} value={destino} onChange={(e) => escolher(coluna, e.target.value)} className="lastro-campo h-9 w-full px-2 text-sm">
                <option value="">Não mapear</option>
                {analise.colunas_padrao.map((p) => {
                  const dono = usados.get(p);
                  return <option key={p} value={p}>{p}{dono && dono !== coluna ? ` (hoje em "${dono}")` : ''}</option>;
                })}
              </select>
              {destino && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{DESCRICAO_COLUNA[destino as ColunaUpload]}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Botao onClick={onVoltar} disabled={processando}>Voltar</Botao>
        <Botao variante="primario" onClick={onProcessar} disabled={processando}>
          <CheckCircle2 className="size-4" /> {processando ? 'Processando…' : 'Processar Arquivo'}
        </Botao>
      </div>
    </div>
  );
}
