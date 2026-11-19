'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/cliente';
import type { PdfInfo } from '@/lib/repo';
import { Dialogo, Etiqueta } from '@/components/ui';
import { EnvioPdfs } from '@/components/EnvioPdfs';

const ROTULO_STATUS: Record<string, { texto: string; cor: 'emerald' | 'amber' | 'orange' | 'rose' | 'sky' }> = {
  indexado: { texto: 'com texto', cor: 'emerald' },
  pendente: { texto: 'na fila', cor: 'sky' },
  indexando: { texto: 'lendo…', cor: 'sky' },
  sem_texto: { texto: 'sem texto (escaneado)', cor: 'orange' },
  falhou: { texto: 'falhou', cor: 'rose' },
};

export function DialogoPdfs({ aberto, baseId, onFechar, onMudou, onAbrir }: {
  aberto: boolean;
  baseId: string;
  onFechar: () => void;
  onMudou: () => void;
  onAbrir: (p: PdfInfo) => void;
}) {
  const [pdfs, setPdfs] = useState<PdfInfo[]>([]);
  const [indexando, setIndexando] = useState(false);
  const [filtro, setFiltro] = useState('');

  const carregar = useCallback(() => api.pdfs(baseId).then((r) => { setPdfs(r.pdfs); setIndexando(r.indexando); }).catch(() => {}), [baseId]);
  useEffect(() => { if (aberto) carregar(); }, [aberto, carregar]);
  useEffect(() => {
    if (!aberto || !(indexando || pdfs.some((p) => p.status === 'pendente' || p.status === 'indexando'))) return;
    const t = setInterval(() => { carregar(); onMudou(); }, 2500);
    return () => clearInterval(t);
  }, [aberto, indexando, pdfs, carregar, onMudou]);

  const visiveis = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return f ? pdfs.filter((p) => p.nome_arquivo.toLowerCase().includes(f) || (p.caminho_relativo ?? '').toLowerCase().includes(f)) : pdfs;
  }, [pdfs, filtro]);

  return (
    <Dialogo aberto={aberto} titulo={`PDFs da base (${pdfs.length})`} onFechar={onFechar} largura="max-w-3xl">
      <EnvioPdfs baseId={baseId} compacto onEnviado={() => { carregar(); onMudou(); }} />
      <div className="mt-3 flex items-center gap-2">
        <input className="lastro-campo h-8 flex-1 px-3 text-sm" placeholder="Filtrar pelo nome do arquivo" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        {pdfs.some((p) => p.status === 'falhou') && (
          <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => api.ajustarPdf(baseId, { reindexar: true }).then(carregar)}>tentar de novo os que falharam</button>
        )}
      </div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr><th className="py-1">Arquivo</th><th>Págs.</th><th>Situação</th><th>Tipo</th><th>Vínc.</th></tr>
        </thead>
        <tbody>
          {visiveis.slice(0, 500).map((p) => (
            <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="max-w-[320px] py-1 pr-2">
                <button type="button" className="block truncate text-left hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline dark:text-indigo-400" title={p.caminho_relativo ?? p.nome_arquivo} onClick={() => onAbrir(p)}>{p.nome_arquivo}</button>
                {p.erro && <span className="block truncate text-[11px] text-rose-600" title={p.erro}>{p.erro}</span>}
              </td>
              <td className="tabular-nums">{p.paginas_com_texto ?? '–'}{p.total_paginas ? `/${p.total_paginas}` : ''}</td>
              <td><Etiqueta cor={ROTULO_STATUS[p.status]?.cor ?? 'sky'}>{ROTULO_STATUS[p.status]?.texto ?? p.status}</Etiqueta></td>
              <td>
                <select
                  className="lastro-campo h-6 px-1 text-[11px]"
                  value={p.tipo_declarado ?? ''}
                  title="Ajuda a pré-classificação quando o PDF não tem a capa de termo"
                  onChange={(e) => api.ajustarPdf(baseId, { pdf_id: p.id, tipo: (e.target.value || null) as 'termo' | 'lastro' | null }).then(carregar)}
                >
                  <option value="">automático</option><option value="termo">termo</option><option value="lastro">lastro</option>
                </select>
              </td>
              <td className="tabular-nums">{p.vinculos || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {visiveis.length > 500 && <p className="mt-2 text-xs text-slate-500">Mostrando 500 de {visiveis.length}. Use o filtro.</p>}
    </Dialogo>
  );
}
