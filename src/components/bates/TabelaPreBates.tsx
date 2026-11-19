'use client';

import { Fragment, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileText, Loader2, X } from 'lucide-react';
import type { PaginaPreBates, PreBate } from '@/lib/bates/preMatches';
import { NIVEIS_CONFIABILIDADE } from '@/lib/bates/comparacao';
import { ROTULO_CRITERIO } from '@/lib/bates/cascata';
import { CAMPO_POR_ID } from '@/lib/campos';
import { Botao, cx, Etiqueta, Selo } from '@/components/ui';
import { Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { ParBaseLeitura, valorTela } from '@/components/bates/comum';

const corConfiabilidade = (p: number) =>
  p >= 80 ? { texto: 'text-emerald-700 dark:text-emerald-400', barra: 'bg-emerald-500' }
    : p >= 60 ? { texto: 'text-amber-700 dark:text-amber-400', barra: 'bg-amber-500' }
      : { texto: 'text-rose-700 dark:text-rose-400', barra: 'bg-rose-500' };

function Confiabilidade({ item }: { item: PreBate }) {
  const c = item.confiabilidade;
  const cor = corConfiabilidade(c.percentual);
  return (
    <div className="min-w-[88px] cursor-help" title={c.campos.map((x) => `${x.confere ? '✓' : '✗'} ${x.campo}`).join('\n')}>
      <div className={cx('text-sm font-bold tabular-nums', cor.texto)}>{c.percentual}%</div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={cx('h-full rounded-full', cor.barra)} style={{ width: `${c.percentual}%` }} />
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{c.conferem} de {c.total} campos</div>
    </div>
  );
}

export function TabelaPreBates({
  dados, carregando, aba, niveis, selecionados, ocupado,
  onNiveis, onPagina, onMarcar, onSelecionarTodos, onLimpar, onConfirmar, onRejeitar, onVerPdf,
}: {
  dados: PaginaPreBates | null;
  carregando: boolean;
  aba: 'todos' | 'termo' | 'lastro';
  niveis: number[];
  selecionados: Set<number>;
  ocupado: boolean;
  onNiveis: (n: number[]) => void;
  onPagina: (p: number) => void;
  /** Marca ou desmarca estes pré-bates. */
  onMarcar: (ids: number[], marcar: boolean) => void;
  onSelecionarTodos: () => void;
  onLimpar: () => void;
  onConfirmar: (ids: number[]) => void;
  onRejeitar: (ids: number[]) => void;
  onVerPdf: (item: PreBate) => void;
}) {
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const itens = dados?.itens ?? [];
  const alternarAberto = (id: number) => setAbertos((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todosDaPagina = itens.length > 0 && itens.every((i) => selecionados.has(i.pre_match_id));
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.tamanho)) : 1;

  return (
    <div className="space-y-4">
      {/* Seleção e ações em lote */}
      <div className="flex flex-wrap items-center gap-2">
        <Botao tamanho="sm" onClick={onSelecionarTodos} disabled={!dados?.total || ocupado}>
          {niveis.length ? 'Selecionar Todos do filtro' : 'Selecionar Todos'} ({dados?.total ?? 0})
        </Botao>
        {selecionados.size > 0 && (
          <>
            <Botao tamanho="sm" variante="fantasma" onClick={onLimpar} disabled={ocupado}>Limpar Seleção</Botao>
            <Botao tamanho="sm" variante="sucesso" onClick={() => onConfirmar([...selecionados])} disabled={ocupado}>
              {ocupado ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Aprovar Selecionados ({selecionados.size})
            </Botao>
            <Botao tamanho="sm" variante="perigo" onClick={() => onRejeitar([...selecionados])} disabled={ocupado}>
              <X className="size-3.5" /> Rejeitar Selecionados ({selecionados.size})
            </Botao>
          </>
        )}
      </div>

      {/* Filtro por confiabilidade */}
      {dados && Object.keys(dados.por_confiabilidade).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500 dark:text-slate-400">Confiabilidade:</span>
          {NIVEIS_CONFIABILIDADE.map((nivel) => {
            const qtd = dados.por_confiabilidade[nivel] ?? 0;
            const ativo = niveis.includes(nivel);
            if (!qtd && !ativo) return null;
            return (
              <button
                key={nivel}
                type="button"
                aria-pressed={ativo}
                onClick={() => onNiveis(ativo ? niveis.filter((n) => n !== nivel) : [...niveis, nivel])}
                className={cx('rounded-full border-[1.5px] px-3 py-0.5 text-xs font-bold transition-colors',
                  ativo ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-300 text-slate-600 hover:border-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-300')}
              >
                {nivel}% <span className="font-normal opacity-70">({qtd})</span>
              </button>
            );
          })}
          {niveis.length > 0 && <button type="button" className="text-xs text-slate-500 underline decoration-dotted dark:text-slate-400" onClick={() => onNiveis([])}>Limpar filtro</button>}
        </div>
      )}

      {carregando && !dados ? (
        <p className="flex items-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400"><Loader2 className="size-4 animate-spin" /> Carregando os pré-bates…</p>
      ) : !itens.length ? (
        <Vazio icone={<IconeRabisco tipo="v" tamanho={40} />} titulo={niveis.length ? 'Nenhum pré-bate com essa confiabilidade' : 'Nenhum pré-bate a confirmar'}>
          {niveis.length ? 'Limpe o filtro para ver os outros.' : `Clique em "Processar Base" para cruzar as leituras com os títulos${aba !== 'todos' ? ` (${aba === 'termo' ? 'Termos' : 'Lastros'})` : ''}.`}
        </Vazio>
      ) : (
        <div className={cx('rolagem-fina overflow-x-auto rounded-xl border-[1.5px] border-slate-900 dark:border-slate-600', carregando && 'opacity-60')}>
          <table className="w-full min-w-[980px] text-sm">
            <thead className="lastro-rotulo bg-slate-50 text-left text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label="Marcar todos desta página" checked={todosDaPagina}
                    onChange={() => onMarcar(itens.map((i) => i.pre_match_id), !todosDaPagina)} />
                </th>
                <th className="px-2 py-2">Nº Doc (Base / Leitura)</th>
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">Valor nominal</th>
                <th className="px-2 py-2">Vencimento</th>
                <th className="px-2 py-2">Cedente</th>
                <th className="px-2 py-2">Sacado</th>
                <th className="px-2 py-2" title="Quantos destes campos conferem entre base e leitura: número, valor, vencimento, cedente e sacado">Confiabilidade</th>
                <th className="px-2 py-2 text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => {
                const aberto = abertos.has(item.pre_match_id);
                const conf = Object.fromEntries(item.confiabilidade.campos.map((c) => [c.campo, c.confere]));
                return (
                  <Fragment key={item.pre_match_id}>
                    <tr className={cx('border-b border-slate-100 align-top dark:border-slate-800', selecionados.has(item.pre_match_id) && 'bg-sky-50/70 dark:bg-sky-500/10')}>
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`Selecionar ${item.base.numero_documento ?? ''}`} checked={selecionados.has(item.pre_match_id)} onChange={() => onMarcar([item.pre_match_id], !selecionados.has(item.pre_match_id))} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-start gap-1">
                          <button type="button" onClick={() => alternarAberto(item.pre_match_id)} className="mt-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" aria-label={aberto ? 'Recolher detalhes' : 'Expandir detalhes'}>
                            {aberto ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </button>
                          <div className="font-mono leading-tight">
                            <div className="font-bold">{item.base.numero_documento ?? '—'}</div>
                            <div className={cx('text-[11px]', conf['Número do documento'] ? 'text-slate-500 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400')}>{item.leitura.numero_documento ?? '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2"><Etiqueta cor={item.lado === 'termo' ? 'violet' : 'sky'}>{item.tipo_validacao}</Etiqueta></td>
                      <td className="px-2 py-2 tabular-nums"><ParBaseLeitura campo="valor_total" base={item.base.valor_nominal} leitura={item.leitura.valor_nominal} confere={conf['Valor nominal']} /></td>
                      <td className="px-2 py-2 tabular-nums"><ParBaseLeitura campo="data_vencimento" base={item.base.data_vencimento} leitura={item.leitura.data_vencimento} confere={conf['Data de vencimento']} /></td>
                      <td className="max-w-[170px] px-2 py-2"><ParBaseLeitura campo="cedente_nome" base={item.base.nome_cedente} leitura={item.leitura.nome_cedente} confere={conf.Cedente} /></td>
                      <td className="max-w-[170px] px-2 py-2"><ParBaseLeitura campo="sacado_nome" base={item.base.nome_sacado} leitura={item.leitura.nome_sacado} confere={conf.Sacado} /></td>
                      <td className="px-2 py-2"><Confiabilidade item={item} /></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" title="Confirmar" disabled={ocupado} onClick={() => onConfirmar([item.pre_match_id])} className="grid size-7 place-items-center rounded-full border-[1.5px] border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-500/10"><Check className="size-4" /></button>
                          <button type="button" title="Rejeitar" disabled={ocupado} onClick={() => onRejeitar([item.pre_match_id])} className="grid size-7 place-items-center rounded-full border-[1.5px] border-rose-600 text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-500 dark:text-rose-400 dark:hover:bg-rose-500/10"><X className="size-4" /></button>
                          <button type="button" title={item.leitura.pdf_id ? 'Visualizar documento PDF' : 'Esta leitura não tem PDF'} disabled={!item.leitura.pdf_id} onClick={() => onVerPdf(item)} className="grid size-7 place-items-center rounded-full border-[1.5px] border-slate-400 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-500 dark:text-slate-300 dark:hover:bg-slate-800"><FileText className="size-4" /></button>
                        </div>
                      </td>
                    </tr>
                    {aberto && (
                      <tr className="border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/50">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                            <table className="w-full text-xs">
                              <thead className="lastro-rotulo text-left text-slate-500 dark:text-slate-400">
                                <tr><th className="py-1">Campo</th><th className="py-1">Base</th><th className="py-1">Leitura</th><th className="py-1 text-center">V/D/P</th></tr>
                              </thead>
                              <tbody>
                                {(item.campos ?? []).map((c) => (
                                  <tr key={c.campo} className="border-t border-slate-200/70 dark:border-slate-800">
                                    <td className="py-1 pr-2 font-medium text-slate-700 dark:text-slate-200">{CAMPO_POR_ID[c.campo].rotulo}</td>
                                    <td className="break-all py-1 pr-2">{valorTela(c.campo, c.base)}</td>
                                    <td className="break-all py-1 pr-2">{valorTela(c.campo, c.leitura)}</td>
                                    <td className="py-1 text-center"><Selo valor={c.veredito} tamanho="sm" /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="space-y-2 text-xs">
                              <p className="lastro-rotulo text-slate-500 dark:text-slate-400">Confiabilidade</p>
                              <ul className="space-y-1">
                                {item.confiabilidade.campos.map((c) => (
                                  <li key={c.campo} className="flex items-center gap-2">
                                    {c.confere ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <X className="size-3.5 text-rose-600 dark:text-rose-400" />}
                                    <span className="text-slate-700 dark:text-slate-200">{c.campo}</span>
                                    <span className="ml-auto text-slate-500 dark:text-slate-400">{c.confere ? 'confere' : 'diverge ou sem dado'}</span>
                                  </li>
                                ))}
                              </ul>
                              <p className="text-slate-500 dark:text-slate-400">
                                Critério {item.criterio ?? '—'}{item.criterio ? `: ${ROTULO_CRITERIO[item.criterio]}` : ''} · similaridade {item.similaridade.toFixed(1)}
                              </p>
                              <p className="text-slate-500 dark:text-slate-400">
                                Leitura {item.leitura.origem === 'ia' ? 'da IA' : item.leitura.origem}{item.leitura.pdf_nome ? ` · ${item.leitura.pdf_nome}` : ' · sem PDF'}
                              </p>
                              <p className="text-slate-500 dark:text-slate-400">Os V/D/P ao lado são os que o bate recebe ao confirmar (a comparação do Excel de Resultados).</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dados && paginas > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{dados.total} pré-bate(s) · página {dados.pagina} de {paginas}</span>
          <div className="flex gap-2">
            <Botao tamanho="sm" variante="fantasma" disabled={dados.pagina <= 1 || carregando} onClick={() => onPagina(dados.pagina - 1)}>← Anterior</Botao>
            <Botao tamanho="sm" variante="fantasma" disabled={dados.pagina >= paginas || carregando} onClick={() => onPagina(dados.pagina + 1)}>Próxima →</Botao>
          </div>
        </div>
      )}
    </div>
  );
}
