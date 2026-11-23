'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, EyeOff, FolderInput, GraduationCap, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react';
import { Indicador, Secao, Vazio } from '@/components/Pagina';
import { Aviso, Botao, Dialogo, Etiqueta, cx } from '@/components/ui';
import { IconeRabisco } from '@/components/rabiscos';
import { ErroApi } from '@/lib/cliente';
import { treinoApi, type AcaoDocumento, type Candidato, type ResumoTreino, type TipoTreinado } from '@/lib/cliente/treino';
import { EditorTipo, type OrigemAmostra } from './EditorTipo';

type Mensagem = { tipo: 'ok' | 'erro' | 'info' | 'alerta'; texto: string } | null;
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const ROTULO_SITUACAO = { separado: ['Separado', 'violet'], ignorado: ['Ignorado', 'slate'], treinado: ['Treinado', 'emerald'] } as const;

/**
 * Gestão › Treinar IA (pages/TreinamentoIA do Bate Lastro): os documentos que a IA não leu e os
 * tipos treinados que passam a ser classificados e lidos no Anexo.
 */
export function TelaTreino() {
  const [aba, setAba] = useState<'documentos' | 'tipos'>('documentos');
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [tipos, setTipos] = useState<TipoTreinado[] | null>(null);
  const [desativados, setDesativados] = useState<TipoTreinado[]>([]);
  const [editor, setEditor] = useState<{ tipo: TipoTreinado | null; amostra: OrigemAmostra } | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    treinoApi.tipos().then((r) => { if (ativo) { setTipos(r.itens); setDesativados(r.desativados); } })
      .catch(() => { if (ativo) setMensagem({ tipo: 'erro', texto: 'Não foi possível carregar os tipos treinados.' }); });
    return () => { ativo = false; };
  }, [versao]);

  const recarregar = () => setVersao((v) => v + 1);
  const avisar = useCallback((tipo: NonNullable<Mensagem>['tipo'], texto: string) => setMensagem({ tipo, texto }), []);

  return (
    <div className="space-y-6">
      {mensagem && <div className="relative"><Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso><button type="button" className="absolute right-3 top-2 text-slate-500" onClick={() => setMensagem(null)} aria-label="Fechar">×</button></div>}

      <div className="flex flex-wrap items-center gap-6 border-b border-dashed border-slate-300 dark:border-slate-700">
        {([['documentos', 'Documentos para treinar'], ['tipos', `Tipos treinados${tipos ? ` (${tipos.length})` : ''}`]] as const).map(([id, rotulo]) => (
          <button key={id} type="button" onClick={() => setAba(id)} className={cx('-mb-px border-b-2 pb-2 text-sm font-bold transition-colors', aba === id ? 'border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400')}>
            {rotulo}
          </button>
        ))}
        <Botao variante="primario" tamanho="sm" className="mb-2 ml-auto" onClick={() => setEditor({ tipo: null, amostra: null })}><Plus className="size-4" /> Novo tipo</Botao>
      </div>

      {aba === 'documentos'
        ? <DocumentosParaTreinar tipos={tipos ?? []} versao={versao} avisar={avisar} onTreinar={(amostra) => setEditor({ tipo: null, amostra })} />
        : <ListaTipos tipos={tipos} desativados={desativados} avisar={avisar} onEditar={(t) => setEditor({ tipo: t, amostra: null })} onMudou={recarregar} />}

      <Dialogo aberto={Boolean(editor)} titulo={editor?.tipo ? `Editar tipo: ${editor.tipo.nome_exibicao}` : 'Novo tipo de documento'} onFechar={() => setEditor(null)} largura="max-w-5xl">
        {editor && (
          <EditorTipo
            key={editor.tipo?.id ?? `novo-${editor.amostra?.documentoId ?? ''}`}
            tipo={editor.tipo}
            amostraInicial={editor.amostra}
            onCancelar={() => setEditor(null)}
            onSalvo={(t) => {
              setEditor(null);
              recarregar();
              avisar('ok', `Tipo "${t.nome_exibicao}" salvo. Os próximos documentos assim enviados no Anexo já são classificados e lidos com ele; para os que já estão na fila, use "Ler de novo".`);
            }}
          />
        )}
      </Dialogo>
    </div>
  );
}

function ListaTipos({ tipos, desativados, avisar, onEditar, onMudou }: {
  tipos: TipoTreinado[] | null; desativados: TipoTreinado[]; avisar: (t: 'ok' | 'erro', s: string) => void; onEditar: (t: TipoTreinado) => void; onMudou: () => void;
}) {
  const [busca, setBusca] = useState('');
  const visiveis = (tipos ?? []).filter((t) => !busca.trim() || `${t.nome_exibicao} ${t.slug}`.toLowerCase().includes(busca.trim().toLowerCase()));

  const desativar = async (t: TipoTreinado) => {
    if (!window.confirm(`Desativar "${t.nome_exibicao}"? Ele sai da classificação do Anexo (as leituras já feitas ficam). Dá para restaurar depois.`)) return;
    try { await treinoApi.desativar(t.id); onMudou(); avisar('ok', 'Tipo desativado.'); } catch (e) { avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível desativar.'); }
  };
  const restaurar = async (t: TipoTreinado) => {
    try { await treinoApi.restaurar(t.id); onMudou(); avisar('ok', `"${t.nome_exibicao}" voltou para a classificação.`); } catch (e) { avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível restaurar.'); }
  };

  return (
    <Secao>
      {!tipos ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Carregando tipos treinados…</p> : !tipos.length ? (
        <Vazio icone={<GraduationCap className="size-10" />} titulo="Nenhum tipo treinado ainda">
          Quando a IA não reconhece um documento (sai como “outro documento”), descreva aqui o que ele é e quais campos tem. Depois de um teste num PDF de exemplo, o tipo passa a ser classificado e lido no Anexo.
        </Vazio>
      ) : (
        <>
          <div className="relative mb-3 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="lastro-campo h-9 w-full pl-9 pr-3 text-sm" placeholder="Buscar tipo" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
                <tr><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Comprova</th><th className="px-3 py-2">Campos</th><th className="px-3 py-2">Parcelas</th><th className="px-3 py-2">Documentos lidos</th><th className="px-3 py-2">Atualizado em</th><th className="px-3 py-2 text-right">Ações</th></tr>
              </thead>
              <tbody>
                {visiveis.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2"><span className="font-semibold">{t.nome_exibicao}</span><span className="block font-mono text-[11px] text-slate-500">{t.slug}</span></td>
                    <td className="px-3 py-2"><Etiqueta cor={t.slug.startsWith('termo_cessao') ? 'violet' : 'sky'}>{t.slug.startsWith('termo_cessao') ? 'Termo' : 'Lastro'}</Etiqueta></td>
                    <td className="px-3 py-2">{Object.values(t.campos).filter((c) => c.presente).length}</td>
                    <td className="px-3 py-2">{t.multi_recebiveis ? 'várias linhas' : 'uma linha'}</td>
                    <td className="px-3 py-2 tabular-nums">{t.documentos_lidos}</td>
                    <td className="px-3 py-2 text-slate-500">{dataHora(t.atualizado_em)} · v{t.versao}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Botao tamanho="sm" onClick={() => onEditar(t)}><Pencil className="size-3.5" /> Editar</Botao>
                        <Botao tamanho="sm" variante="fantasma" onClick={() => desativar(t)} title="Desativar"><Trash2 className="size-3.5" /></Botao>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {desativados.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-500">{desativados.length} tipo(s) desativado(s)</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {desativados.map((t) => (
              <li key={t.id} className="flex items-center gap-3"><span className="text-slate-500 line-through">{t.nome_exibicao}</span><button type="button" className="flex items-center gap-1 text-xs text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => restaurar(t)}><RotateCcw className="size-3" /> restaurar</button></li>
            ))}
          </ul>
        </details>
      )}
    </Secao>
  );
}

function DocumentosParaTreinar({ tipos, versao, avisar, onTreinar }: {
  tipos: TipoTreinado[]; versao: number; avisar: (t: 'ok' | 'erro' | 'info', s: string) => void; onTreinar: (a: OrigemAmostra) => void;
}) {
  const [base, setBase] = useState('');
  const [pendentes, setPendentes] = useState(false);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<{ itens: Candidato[]; total: number; tamanho: number; resumo: ResumoTreino } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [grupo, setGrupo] = useState('');
  const [tipoTreinado, setTipoTreinado] = useState('');
  const [proprio, setProprio] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let ativo = true;
    treinoApi.documentos({ base, pendentes, busca, pagina }).then((r) => { if (ativo) setDados(r); })
      .catch(() => { if (ativo) avisar('erro', 'Não foi possível carregar os documentos para treinar.'); });
    return () => { ativo = false; };
  }, [base, pendentes, busca, pagina, versao, proprio, avisar]);

  const agir = async (acao: AcaoDocumento, extra: { grupo?: string | null; tipo_documento_id?: number } = {}) => {
    if (!sel.size) return;
    setOcupado(true);
    try {
      const r = await treinoApi.acao(acao, [...sel], extra);
      const frase: Record<AcaoDocumento, string> = {
        separar: 'separado(s) para treinar', ignorar: 'ignorado(s)', grupo: 'movido(s) de grupo', desfazer: 'de volta para pendente',
        treinados: 'marcado(s) como treinado(s)', ler_de_novo: 'de volta na fila do Anexo (acompanhe em Análise › Lotes)',
      };
      avisar('ok', `${r.alterados} documento(s) ${frase[acao]}.`);
      setSel(new Set());
      setProprio((n) => n + 1);
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  };

  const r = dados?.resumo;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.tamanho)) : 1;
  const unico = sel.size === 1 ? dados?.itens.find((i) => sel.has(i.documento_id)) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Indicador rotulo="A decidir" valor={r?.pendentes ?? '—'} cor="ambar" detalhe="Sem decisão de ninguém" />
        <Indicador rotulo="Separados" valor={r?.separados ?? '—'} cor="indigo" detalhe={r?.grupos.length ? `${r.grupos.length} grupo(s)` : 'Para treinar'} />
        <Indicador rotulo="Treinados" valor={r?.treinados ?? '—'} cor="verde" detalhe="Já têm tipo" />
        <Indicador rotulo="Ignorados" valor={r?.ignorados ?? '—'} detalhe="Não precisam de leitura" />
      </div>

      <Secao titulo="Documentos que a IA não leu" descricao="PDFs do Anexo classificados como “outro documento” ou “intervenção humana”, sem leitura. Separe os parecidos num grupo, treine um tipo com um deles de exemplo e mande ler de novo.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="lastro-campo h-9 px-2 text-sm" value={base} onChange={(e) => { setBase(e.target.value); setPagina(1); }} aria-label="Base">
            <option value="">Todas as bases</option>
            {r?.bases.map((b) => <option key={b.base_id} value={b.base_id}>{b.base_nome} ({b.n})</option>)}
          </select>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="lastro-campo h-9 w-full pl-9 pr-3 text-sm" placeholder="Buscar pelo nome do arquivo" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
          </div>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={pendentes} onChange={(e) => { setPendentes(e.target.checked); setPagina(1); }} /> só os a decidir</label>
          <Botao tamanho="sm" variante="fantasma" onClick={() => setProprio((n) => n + 1)} title="Atualizar"><RefreshCw className="size-4" /></Botao>
        </div>

        {sel.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
            <b>{sel.size} selecionado(s)</b>
            <input className="lastro-campo h-8 w-44 px-2 text-xs" list="grupos-treino" placeholder="Grupo (ex.: Mútuo rural)" value={grupo} onChange={(e) => setGrupo(e.target.value)} />
            <datalist id="grupos-treino">{r?.grupos.filter((g) => g.grupo).map((g) => <option key={g.grupo} value={g.grupo} />)}</datalist>
            <Botao tamanho="sm" disabled={ocupado} onClick={() => agir('separar', { grupo })}><FolderInput className="size-3.5" /> Separar para treinar</Botao>
            <Botao tamanho="sm" disabled={ocupado} onClick={() => agir('ignorar')}><EyeOff className="size-3.5" /> Ignorar</Botao>
            <Botao tamanho="sm" variante="fantasma" disabled={ocupado} onClick={() => agir('desfazer')}><Undo2 className="size-3.5" /> Desfazer</Botao>
            {unico && <Botao tamanho="sm" variante="primario" onClick={() => onTreinar({ documentoId: unico.documento_id, nome: unico.nome_arquivo })}><GraduationCap className="size-3.5" /> Treinar tipo com este</Botao>}
            {tipos.length > 0 && (
              <span className="flex items-center gap-1">
                <select className="lastro-campo h-8 px-2 text-xs" value={tipoTreinado} onChange={(e) => setTipoTreinado(e.target.value)} aria-label="Tipo treinado">
                  <option value="">Tipo treinado…</option>
                  {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome_exibicao}</option>)}
                </select>
                <Botao tamanho="sm" disabled={!tipoTreinado || ocupado} onClick={() => agir('treinados', { tipo_documento_id: Number(tipoTreinado) })}>Marcar treinados</Botao>
              </span>
            )}
            <Botao tamanho="sm" variante="primario" disabled={ocupado} onClick={() => agir('ler_de_novo')} title="Põe de volta na fila do Anexo: a classificação já considera os tipos treinados"><BookOpen className="size-3.5" /> Ler de novo</Botao>
          </div>
        )}

        {!dados ? <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Carregando…</p> : !dados.itens.length ? (
          <Vazio icone={<IconeRabisco tipo="v" tamanho={40} />} titulo={busca || base || pendentes ? 'Nada com esse filtro' : 'A IA leu tudo o que recebeu'}>
            Documentos classificados como “outro documento” ou “intervenção humana” no Anexo aparecem aqui.
          </Vazio>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Selecionar a página" checked={dados.itens.every((i) => sel.has(i.documento_id))} onChange={(e) => setSel(e.target.checked ? new Set(dados.itens.map((i) => i.documento_id)) : new Set())} /></th>
                    <th className="px-3 py-2">Arquivo</th><th className="px-3 py-2">Base</th><th className="px-3 py-2">A IA disse</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Classificado em</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((d) => {
                    const st = d.situacao ? ROTULO_SITUACAO[d.situacao] : null;
                    return (
                      <tr key={d.documento_id} className={cx('border-t border-slate-100 dark:border-slate-800', sel.has(d.documento_id) && 'bg-indigo-50/50 dark:bg-indigo-500/10')}>
                        <td className="px-3 py-2"><input type="checkbox" checked={sel.has(d.documento_id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(d.documento_id)) n.delete(d.documento_id); else n.add(d.documento_id); return n; })} aria-label={`Selecionar ${d.nome_arquivo}`} /></td>
                        <td className="max-w-[320px] px-3 py-2">
                          {d.pdf_id ? <a className="font-semibold hover:underline" href={treinoApi.urlPdf(d.documento_id)} target="_blank" rel="noreferrer" title={d.caminho}>{d.nome_arquivo}</a> : <span className="font-semibold">{d.nome_arquivo}</span>}
                          {d.caminho !== d.nome_arquivo && <span className="block truncate text-[11px] text-slate-500">{d.caminho}</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{d.base_nome}</td>
                        <td className="px-3 py-2"><Etiqueta cor={d.motivo === 'intervencao_humana' ? 'amber' : 'slate'}>{d.motivo === 'intervencao_humana' ? 'Intervenção humana' : 'Outro documento'}</Etiqueta></td>
                        <td className="px-3 py-2">{st ? <Etiqueta cor={st[1]}>{st[0]}{d.grupo ? ` · ${d.grupo}` : ''}{d.tipo_treinado ? ` · ${d.tipo_treinado}` : ''}</Etiqueta> : <span className="text-xs text-slate-400">a decidir</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{dataHora(d.classificado_em)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>{dados.total} documento(s) · página {pagina} de {paginas}</span>
              <div className="flex gap-2">
                <Botao tamanho="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Botao>
                <Botao tamanho="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</Botao>
              </div>
            </div>
          </>
        )}
      </Secao>
    </div>
  );
}
