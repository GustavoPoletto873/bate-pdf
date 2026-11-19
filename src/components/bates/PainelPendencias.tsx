'use client';

import { useEffect, useState } from 'react';
import { FileText, Link2, Loader2 } from 'lucide-react';
import { apiBates } from '@/lib/cliente/bates';
import { ErroApi } from '@/lib/cliente';
import type { Lado } from '@/lib/campos';
import { ROTULO_LADO } from '@/lib/campos';
import { Aviso, cx, Etiqueta } from '@/components/ui';
import { Secao } from '@/components/Pagina';
import { LinkBotao, valorTela } from '@/components/bates/comum';

type Dados = Awaited<ReturnType<typeof apiBates.orfas>>;

/**
 * Área de pendências da Gestão de Bates: títulos ainda sem documento (por lado) e leituras que
 * não casaram com nenhum título. Aqui elas se resolvem pelo Bater PDF (o "Bate Manual" de
 * arrastar do Bate Lastro não foi trazido).
 */
export function PainelPendencias({ baseId, versao, onVerPdf }: { baseId: string; versao: number; onVerPdf: (pdf: { id: number; nome: string }) => void }) {
  const [estado, setEstado] = useState<{ versao: number; dados: Dados | null; erro: string | null } | null>(null);
  const [aba, setAba] = useState<Lado | 'orfas'>('lastro');

  useEffect(() => {
    let vivo = true;
    apiBates.orfas(baseId)
      .then((dados) => { if (vivo) setEstado({ versao, dados, erro: null }); })
      .catch((e) => { if (vivo) setEstado({ versao, dados: null, erro: e instanceof ErroApi ? e.message : 'Não foi possível carregar as pendências.' }); });
    return () => { vivo = false; };
  }, [baseId, versao]);

  const dados = estado?.dados ?? null;
  const carregando = !estado || estado.versao !== versao;
  const pendencias = dados?.pendencias.filter((p) => p.lado === aba) ?? [];
  const total = aba === 'orfas' ? dados?.total_orfas ?? 0 : dados?.total_pendencias[aba] ?? 0;
  const mostrados = aba === 'orfas' ? dados?.orfas.length ?? 0 : pendencias.length;

  return (
    <Secao
      titulo="Pendências"
      descricao="Títulos que ainda não têm documento e leituras que não casaram com nenhum título. Resolva pelo Bater PDF: busque o documento, confira campo a campo e vincule."
      acoes={<LinkBotao href={`/bases/${baseId}`} variante="primario" tamanho="sm"><Link2 className="size-3.5" /> Resolver no Bater PDF</LinkBotao>}
    >
      {estado?.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      <div className="mb-3 flex flex-wrap gap-1">
        {([['lastro', `Sem Lastro (${dados?.total_pendencias.lastro ?? 0})`], ['termo', `Sem Termo (${dados?.total_pendencias.termo ?? 0})`], ['orfas', `Leituras sem título (${dados?.total_orfas ?? 0})`]] as const).map(([id, rotulo]) => (
          <button key={id} type="button" onClick={() => setAba(id)}
            className={cx('rounded-full px-3 py-1 text-xs font-bold transition-colors', aba === id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
            {rotulo}
          </button>
        ))}
        {carregando && <Loader2 className="ml-2 size-4 animate-spin self-center text-slate-400" />}
      </div>

      {!dados ? null : !total ? (
        <p className="py-4 text-center font-serif text-sm text-slate-500 dark:text-slate-400">
          {aba === 'orfas' ? 'Nenhuma leitura sobrando: todas casaram com um título.' : `Nenhum título sem ${ROTULO_LADO[aba].toLowerCase()}.`}
        </p>
      ) : (
        <div className="rolagem-fina max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {aba === 'orfas' ? (
            <table className="w-full text-xs">
              <thead className="lastro-rotulo sticky top-0 bg-slate-50 text-left text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr><th className="px-3 py-1.5">Nº documento</th><th className="px-2 py-1.5">Tipo</th><th className="px-2 py-1.5">Valor</th><th className="px-2 py-1.5">Vencimento</th><th className="px-2 py-1.5">Sacado</th><th className="px-2 py-1.5">Origem</th><th className="px-2 py-1.5">PDF</th></tr>
              </thead>
              <tbody>
                {dados.orfas.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-1 font-mono">{l.numero_documento ?? '—'}</td>
                    <td className="px-2 py-1"><Etiqueta cor={l.lado === 'termo' ? 'violet' : 'sky'}>{l.lado === 'termo' ? 'TERMO' : 'LASTRO'}</Etiqueta></td>
                    <td className="px-2 py-1 tabular-nums">{valorTela('valor_total', l.valor_nominal)}</td>
                    <td className="px-2 py-1 tabular-nums">{valorTela('data_vencimento', l.data_vencimento)}</td>
                    <td className="max-w-[220px] truncate px-2 py-1">{l.sacado_nome ?? '—'}</td>
                    <td className="px-2 py-1">{l.origem === 'ia' ? 'IA' : l.origem}</td>
                    <td className="px-2 py-1">
                      {l.pdf_id ? (
                        <button type="button" className="inline-flex max-w-[200px] items-center gap-1 truncate underline decoration-dotted hover:text-indigo-600 dark:hover:text-indigo-400" onClick={() => onVerPdf({ id: l.pdf_id!, nome: l.pdf_nome ?? `PDF ${l.pdf_id}` })}>
                          <FileText className="size-3 shrink-0" />{l.pdf_nome ?? `PDF ${l.pdf_id}`}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs">
              <thead className="lastro-rotulo sticky top-0 bg-slate-50 text-left text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr><th className="px-3 py-1.5">Nº documento</th><th className="px-2 py-1.5">Valor</th><th className="px-2 py-1.5">Vencimento</th><th className="px-2 py-1.5">Sacado</th><th className="px-2 py-1.5">Cedente</th><th className="px-2 py-1.5">ID_BASE</th></tr>
              </thead>
              <tbody>
                {pendencias.map((p) => (
                  <tr key={p.pendencia_id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-1 font-mono">{p.titulo.numero_documento ?? '—'}</td>
                    <td className="px-2 py-1 tabular-nums">{valorTela('valor_total', p.titulo.valor_total)}</td>
                    <td className="px-2 py-1 tabular-nums">{valorTela('data_vencimento', p.titulo.data_vencimento)}</td>
                    <td className="max-w-[220px] truncate px-2 py-1">{p.titulo.sacado_nome ?? '—'}</td>
                    <td className="max-w-[220px] truncate px-2 py-1">{p.titulo.cedente_nome ?? '—'}</td>
                    <td className="px-2 py-1 text-slate-500 dark:text-slate-400">{p.titulo.id_base_origem ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {dados && mostrados < total && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Mostrando {mostrados} de {total}. A lista completa sai em Resultados → Exportar pendências.</p>}
    </Secao>
  );
}
