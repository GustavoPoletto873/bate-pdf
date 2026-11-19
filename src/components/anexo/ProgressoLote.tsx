'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, RotateCcw } from 'lucide-react';
import { ErroApi } from '@/lib/cliente';
import { apiAnexo, type EstadoLote } from '@/lib/cliente/anexo';
import type { Leitura } from '@/lib/leituras';
import { formatarData, formatarMoeda } from '@/lib/valores';
import { Aviso, Botao, Etiqueta } from '@/components/ui';
import { Secao } from '@/components/Pagina';
import { plural, rotuloTipo, situacao } from './rotulos';

const INTERVALO_MS = 3000;

export function TabelaLeituras({ leituras }: { leituras: Leitura[] }) {
  if (!leituras.length) return null;
  const colunas: [string, (l: Leitura) => React.ReactNode, string?][] = [
    ['Nº Documento', (l) => l.numero_documento, 'font-mono'],
    ['Nome Sacado', (l) => l.sacado_nome],
    ['Doc Sacado', (l) => l.sacado_documento, 'font-mono'],
    ['Nome Cedente', (l) => l.cedente_nome],
    ['Cessionário', (l) => l.cessionario_nome],
    ['Parcela', (l) => (l.numero_parcela ? `${l.numero_parcela}/${l.quantidade_parcelas ?? '?'}` : '')],
    ['Valor Nominal', (l) => formatarMoeda(l.valor_nominal), 'tabular-nums whitespace-nowrap'],
    ['Aquisição', (l) => formatarData(l.data_aquisicao)],
    ['Emissão', (l) => formatarData(l.data_emissao)],
    ['Vencimento', (l) => formatarData(l.data_vencimento)],
    ['Tipo', (l) => rotuloTipo(l.tipo_recebivel)],
  ];
  return (
    <div className="rolagem-fina max-h-[28rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
          <tr>
            {colunas.map(([c]) => <th key={c} className="lastro-rotulo whitespace-nowrap px-2 py-2 text-left text-slate-500 dark:text-slate-400">{c}</th>)}
            <th className="lastro-rotulo px-2 py-2 text-left text-slate-500 dark:text-slate-400">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {leituras.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
              {colunas.map(([c, f, cls]) => <td key={c} className={`px-2 py-1.5 ${cls ?? ''}`}>{f(l)}</td>)}
              <td className="px-2 py-1.5">
                {l.pdf_id && <a href={`/api/pdfs/${l.pdf_id}/arquivo`} target="_blank" rel="noreferrer" title="Visualizar PDF" className="text-indigo-600 hover:underline dark:text-indigo-400"><ExternalLink className="size-3.5" /></a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Acompanha um lote enviado: situação de cada arquivo (com polling) e as leituras extraídas. */
export function ProgressoLote({ loteId }: { loteId: string }) {
  const [estado, setEstado] = useState<EstadoLote | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentando, setTentando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setEstado(await apiAnexo.lote(loteId));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível atualizar o lote.');
    }
  }, [loteId]);

  const emAndamento = !estado || estado.documentos.some((d) => !situacao(d.status).final);

  useEffect(() => {
    if (!emAndamento) return;
    const t = setTimeout(() => { void carregar(); }, estado ? INTERVALO_MS : 0);
    return () => clearTimeout(t);
  }, [estado, emAndamento, carregar]);

  async function tentar(ids: number[]) {
    setTentando(true);
    try {
      await apiAnexo.tentarDeNovo({ documento_ids: ids });
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível pôr os documentos na fila de novo.');
    } finally {
      setTentando(false);
    }
  }

  const docs = estado?.documentos ?? [];
  const finais = docs.filter((d) => situacao(d.status).final).length;
  const comErro = docs.filter((d) => d.status === 'erro');
  const r = estado?.resumo ?? {};

  return (
    <Secao
      className="mt-6"
      titulo={`Documentos recebidos por operação (${docs.length})`}
      descricao={estado ? `Lote de ${new Date(estado.lote.criado_em).toLocaleString('pt-BR')} · ${estado.lote.agrupar_por_pasta ? 'agrupado por pasta' : 'cada arquivo é uma operação'}` : 'Carregando…'}
      acoes={<>
        {comErro.length > 0 && <Botao tamanho="sm" onClick={() => tentar(comErro.map((d) => d.id))} disabled={tentando}><RotateCcw className="size-3.5" /> Tentar de novo ({comErro.length})</Botao>}
        <Botao tamanho="sm" variante="fantasma" onClick={() => void carregar()}><RefreshCw className="size-3.5" /> Atualizar</Botao>
      </>}
    >
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      {docs.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <Etiqueta cor="emerald">{plural(r.lido ?? 0, 'lido', 'lidos')}</Etiqueta>
            <Etiqueta cor="amber">{plural(r.somente_classificado ?? 0, 'só classificado', 'só classificados')}</Etiqueta>
            <Etiqueta cor="rose">{plural(r.erro ?? 0, 'com erro', 'com erro')}</Etiqueta>
            {docs.length - finais > 0 && <Etiqueta cor="sky">{plural(docs.length - finais, 'em andamento', 'em andamento')}</Etiqueta>}
          </div>
          <div className="mb-4 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(100 * finais) / docs.length}%` }} />
          </div>
          <div className="rolagem-fina max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                <tr>{['Arquivo', 'Operação', 'Tipo', 'Situação', ''].map((c) => <th key={c} className="lastro-rotulo px-3 py-2 text-left text-slate-500 dark:text-slate-400">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {docs.map((d) => {
                  const s = situacao(d.status);
                  return (
                    <tr key={d.id} className="align-top">
                      <td className="break-all px-3 py-2 text-xs">{d.caminho}{d.origem && d.origem !== d.caminho && <span className="block text-[11px] text-slate-400">{d.origem}</span>}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400" title={d.operacao_id ?? ''}>{d.operacao ?? d.operacao_id?.slice(0, 8) ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{rotuloTipo(d.tipo_documento)}</td>
                      <td className="px-3 py-2">
                        <Etiqueta cor={s.cor}>{s.rotulo}{d.status === 'lido' && d.leituras ? ` · ${d.leituras}` : ''}</Etiqueta>
                        {d.motivo && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{d.motivo}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {d.pdf_id && <a href={`/api/pdfs/${d.pdf_id}/arquivo`} target="_blank" rel="noreferrer" className="mr-2 inline-flex text-indigo-600 hover:underline dark:text-indigo-400" title="Visualizar PDF"><ExternalLink className="size-3.5" /></a>}
                        {d.status === 'erro' && <Botao tamanho="sm" variante="fantasma" onClick={() => tentar([d.id])} disabled={tentando}><RotateCcw className="size-3" /> Tentar de novo</Botao>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {estado && estado.leituras.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 font-display text-base">Documentos Processados <span className="font-sans text-sm font-normal text-slate-500">({plural(estado.leituras.length, 'linha lida', 'linhas lidas')})</span></h3>
          <TabelaLeituras leituras={estado.leituras} />
        </div>
      )}
    </Secao>
  );
}
