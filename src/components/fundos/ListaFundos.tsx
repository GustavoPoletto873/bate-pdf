'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from 'lucide-react';
import type { Administradora, Fundo, PaginaFundos } from '@/lib/fundos';
import { apiFundos } from '@/lib/cliente/fundos';
import { formatarCpfCnpj } from '@/lib/texto';
import { Secao, Vazio } from '@/components/Pagina';
import { Aviso, Botao, Dialogo, Etiqueta, cx } from '@/components/ui';
import { IconeRabisco } from '@/components/rabiscos';
import { EscolhaAdministradora } from './FormularioFundo';
import { mensagemDeErro, rotuloTipo, useAtrasado } from './util';

const POR_PAGINA = 20;

type Edicao = { id: number; nome: string; administradora: string; tipo: string; gestor: string };
type Carga = { chave: string; dados: PaginaFundos | null; erro: string | null };

export function ListaFundos({ administradoras, onAdministradoraCriada, versao, onAlterado }: {
  administradoras: Administradora[];
  onAdministradoraCriada: (a: Administradora) => void;
  /** Muda quando outra parte da tela cadastra ou importa fundos. */
  versao: number;
  onAlterado: () => void;
}) {
  const [buscaDigitada, setBuscaDigitada] = useState('');
  const busca = useAtrasado(buscaDigitada, 400);
  const [filtroAdm, setFiltroAdm] = useState('');
  const chaveFiltro = JSON.stringify([busca.trim(), filtroAdm]);
  // A página volta para 1 quando o filtro muda (guardada junto com o filtro em que foi escolhida).
  const [paginacao, setPaginacao] = useState({ chave: chaveFiltro, pagina: 1 });
  const pagina = paginacao.chave === chaveFiltro ? paginacao.pagina : 1;
  const [recarga, setRecarga] = useState(0);
  const chaveCarga = JSON.stringify([chaveFiltro, pagina, versao, recarga]);
  const [carga, setCarga] = useState<Carga | null>(null);
  const carregando = carga?.chave !== chaveCarga;
  const dados = carga?.dados ?? null;

  // Seleção vale para o filtro inteiro e some quando o filtro muda.
  const [selecao, setSelecao] = useState<{ chave: string; ids: Set<number> }>({ chave: chaveFiltro, ids: new Set() });
  const selecionados = selecao.chave === chaveFiltro ? selecao.ids : new Set<number>();
  const [selecionandoTodos, setSelecionandoTodos] = useState(false);
  const [loteAdm, setLoteAdm] = useState('');
  const [loteGestor, setLoteGestor] = useState('');
  const [aplicando, setAplicando] = useState(false);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [exclusao, setExclusao] = useState<{ fundo: Fundo; uso: { bases: number; amostragens: number } | null } | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const caixaTodos = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    const [, p] = JSON.parse(chaveCarga) as [string, number];
    apiFundos.listar({ busca, administradora: filtroAdm }, p, POR_PAGINA)
      .then((d) => { if (vivo) setCarga({ chave: chaveCarga, dados: d, erro: null }); })
      .catch((e) => { if (vivo) setCarga({ chave: chaveCarga, dados: null, erro: mensagemDeErro(e, 'Não foi possível carregar os fundos. Tente de novo.') }); });
    return () => { vivo = false; };
  }, [chaveCarga, busca, filtroAdm]);

  const total = dados?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  useEffect(() => {
    if (caixaTodos.current) caixaTodos.current.indeterminate = selecionados.size > 0 && selecionados.size < total;
  });

  const recarregar = () => { setRecarga((n) => n + 1); onAlterado(); };
  const irPara = (p: number) => setPaginacao({ chave: chaveFiltro, pagina: Math.min(paginas, Math.max(1, p)) });
  const definirSelecao = (ids: Set<number>) => setSelecao({ chave: chaveFiltro, ids });

  function alternar(id: number) {
    const proximo = new Set(selecionados);
    if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
    definirSelecao(proximo);
  }

  async function alternarTodos() {
    if (selecionados.size > 0 && selecionados.size >= total) { definirSelecao(new Set()); return; }
    setSelecionandoTodos(true);
    try {
      definirSelecao(new Set(await apiFundos.ids({ busca, administradora: filtroAdm })));
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDeErro(e, 'Não foi possível selecionar os fundos. Tente de novo.') });
    } finally {
      setSelecionandoTodos(false);
    }
  }

  function limparLote() {
    definirSelecao(new Set());
    setLoteAdm('');
    setLoteGestor('');
  }

  async function aplicarLote() {
    setAplicando(true);
    setAviso(null);
    try {
      const n = await apiFundos.emLote([...selecionados], {
        ...(loteAdm ? { administradora_id: Number(loteAdm) } : {}),
        ...(loteGestor.trim() ? { gestor: loteGestor.trim() } : {}),
      });
      setAviso({ tipo: 'ok', texto: `${n} fundo(s) atualizado(s).` });
      limparLote();
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDeErro(e, 'Não foi possível atualizar os fundos. Tente de novo.') });
    } finally {
      setAplicando(false);
    }
  }

  async function salvarEdicao() {
    if (!edicao) return;
    if (!edicao.nome.trim()) { setAviso({ tipo: 'erro', texto: 'O nome do fundo não pode ficar vazio.' }); return; }
    setSalvando(true);
    setAviso(null);
    try {
      await apiFundos.atualizar(edicao.id, {
        nome: edicao.nome.trim(), tipo: edicao.tipo,
        administradora_id: edicao.administradora ? Number(edicao.administradora) : null,
        gestor: edicao.gestor.trim() || null,
      });
      setEdicao(null);
      setAviso({ tipo: 'ok', texto: 'Fundo atualizado.' });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDeErro(e, 'Não foi possível salvar o fundo. Tente de novo.') });
    } finally {
      setSalvando(false);
    }
  }

  async function pedirExclusao(fundo: Fundo) {
    setExclusao({ fundo, uso: null });
    try {
      const { uso } = await apiFundos.obter(fundo.id);
      setExclusao((atual) => (atual?.fundo.id === fundo.id ? { fundo, uso } : atual));
    } catch {
      // Sem o uso, o diálogo mostra o aviso genérico.
    }
  }

  async function excluir() {
    if (!exclusao) return;
    setExcluindo(true);
    try {
      await apiFundos.excluir(exclusao.fundo.id);
      setAviso({ tipo: 'ok', texto: `Fundo "${exclusao.fundo.nome}" excluído.` });
      setExclusao(null);
      if (selecionados.has(exclusao.fundo.id)) { const s = new Set(selecionados); s.delete(exclusao.fundo.id); definirSelecao(s); }
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDeErro(e, 'Não foi possível excluir o fundo. Tente de novo.') });
      setExclusao(null);
    } finally {
      setExcluindo(false);
    }
  }

  const teclasEdicao = (e: KeyboardEvent) => {
    if (e.key === 'Enter') salvarEdicao();
    if (e.key === 'Escape') setEdicao(null);
  };
  const temFiltro = Boolean(busca.trim() || filtroAdm);

  return (
    <Secao
      titulo="Fundos cadastrados"
      descricao={dados ? `${total} ${total === 1 ? 'fundo' : 'fundos'}${temFiltro ? ' no filtro' : ' cadastrados'}` : undefined}
      acoes={
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filtrar por administradora" value={filtroAdm} onChange={(e) => setFiltroAdm(e.target.value)} className="lastro-campo h-10 w-56 px-3 text-sm">
            <option value="">Todas as administradoras</option>
            {administradoras.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            <option value="0">Não informado</option>
          </select>
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={buscaDigitada} onChange={(e) => setBuscaDigitada(e.target.value)} placeholder="Buscar por nome ou CNPJ…" aria-label="Buscar por nome ou CNPJ" className="lastro-campo h-10 w-full pl-9 pr-3 text-sm" />
          </div>
        </div>
      }
    >
      {aviso && <div className="mb-4"><Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso></div>}
      {carga?.erro && !carregando && <div className="mb-4"><Aviso tipo="erro">{carga.erro} <button type="button" className="font-semibold underline" onClick={() => setRecarga((n) => n + 1)}>Tentar de novo</button></Aviso></div>}

      {selecionados.size > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border-2 border-slate-900 bg-slate-50 p-3 lg:flex-row lg:items-center dark:border-slate-200 dark:bg-slate-900">
          <p className="text-sm font-semibold lg:mr-auto">{selecionados.size} {selecionados.size === 1 ? 'fundo selecionado' : 'fundos selecionados'}</p>
          <select aria-label="Administradora para os selecionados" value={loteAdm} onChange={(e) => setLoteAdm(e.target.value)} disabled={aplicando} className="lastro-campo h-9 px-3 text-sm lg:w-56">
            <option value="">Manter administradora</option>
            {administradoras.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
          <input aria-label="Gestor para os selecionados" value={loteGestor} onChange={(e) => setLoteGestor(e.target.value)} disabled={aplicando} maxLength={120} placeholder="Manter gestor" className="lastro-campo h-9 px-3 text-sm lg:w-56" />
          <Botao variante="primario" onClick={aplicarLote} disabled={aplicando || (!loteAdm && !loteGestor.trim())}><Check className="size-4" /> {aplicando ? 'Aplicando…' : 'Aplicar'}</Botao>
          <Botao variante="fantasma" onClick={limparLote} disabled={aplicando}>Limpar seleção</Botao>
        </div>
      )}

      {!dados && carregando && <p className="py-10 text-center font-serif text-sm text-slate-500 dark:text-slate-400">Carregando fundos…</p>}
      {dados && dados.itens.length === 0 && (
        <Vazio icone={<IconeRabisco tipo="moeda" tamanho={44} />} titulo={temFiltro ? 'Nenhum fundo encontrado' : 'Nenhum fundo cadastrado ainda'}>
          {temFiltro ? 'Tente outro termo de busca ou outra administradora.' : 'Cadastre o primeiro fundo no formulário acima ou importe uma planilha.'}
        </Vazio>
      )}
      {dados && dados.itens.length > 0 && (
        <div className={cx('overflow-x-auto transition-opacity', carregando && 'opacity-60')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-900 text-left dark:border-slate-200">
                <th className="w-8 px-2 py-2">
                  <input
                    ref={caixaTodos} type="checkbox" className="size-4 accent-slate-900 dark:accent-slate-100"
                    checked={total > 0 && selecionados.size >= total} onChange={alternarTodos} disabled={selecionandoTodos || aplicando}
                    aria-label={`Selecionar todos os ${total} fundos do filtro`} title="Seleciona todos os fundos do filtro, inclusive os das outras páginas."
                  />
                </th>
                {['Nome do fundo', 'CNPJ', 'Tipo', 'Administradora', 'Gestor', 'Bases', ''].map((t, i) => <th key={i} className="lastro-rotulo px-2 py-2">{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((f) => {
                const editando = edicao?.id === f.id ? edicao : null;
                return (
                  <tr key={f.id} className="group border-b border-dashed border-slate-200 align-middle dark:border-slate-800">
                    <td className="px-2 py-2.5">
                      <input type="checkbox" className="size-4 accent-slate-900 dark:accent-slate-100" checked={selecionados.has(f.id)} onChange={() => alternar(f.id)} disabled={aplicando} aria-label={`Selecionar ${f.nome}`} />
                    </td>
                    <td className="px-2 py-2.5 font-medium">
                      {editando
                        ? <input autoFocus value={editando.nome} onChange={(e) => setEdicao({ ...editando, nome: e.target.value })} onKeyDown={teclasEdicao} disabled={salvando} className="lastro-campo h-9 w-full min-w-48 px-2" aria-label="Nome do fundo" />
                        : f.nome}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs text-slate-600 dark:text-slate-400">{formatarCpfCnpj(f.cnpj)}</td>
                    <td className="px-2 py-2.5">
                      {editando
                        ? <select value={editando.tipo} onChange={(e) => setEdicao({ ...editando, tipo: e.target.value })} disabled={salvando} className="lastro-campo h-9 px-2" aria-label="Tipo do fundo"><option value="FIDC">FIDC</option><option value="FIC_FIDC">FIC FIDC</option></select>
                        : <Etiqueta>{rotuloTipo(f.tipo)}</Etiqueta>}
                    </td>
                    <td className="px-2 py-2.5 text-slate-700 dark:text-slate-300">
                      {editando
                        ? <EscolhaAdministradora valor={editando.administradora} onChange={(v) => setEdicao({ ...editando, administradora: v })} administradoras={administradoras} onCriada={onAdministradoraCriada} disabled={salvando} className="min-w-64" />
                        : f.administradora_nome ?? <span className="text-slate-400 dark:text-slate-500">Não informado</span>}
                    </td>
                    <td className="px-2 py-2.5 text-slate-700 dark:text-slate-300">
                      {editando
                        ? <input value={editando.gestor} onChange={(e) => setEdicao({ ...editando, gestor: e.target.value })} onKeyDown={teclasEdicao} disabled={salvando} maxLength={120} placeholder="Não informado" className="lastro-campo h-9 w-40 px-2" aria-label="Gestor do fundo" />
                        : f.gestor ?? <span className="text-slate-400 dark:text-slate-500">Não informado</span>}
                    </td>
                    <td className="px-2 py-2.5 tabular-nums text-slate-600 dark:text-slate-400">{f.bases}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right">
                      {editando ? (
                        <div className="flex justify-end gap-1">
                          <Botao tamanho="sm" variante="sucesso" onClick={salvarEdicao} disabled={salvando} aria-label="Salvar"><Check className="size-3.5" /></Botao>
                          <Botao tamanho="sm" variante="fantasma" onClick={() => setEdicao(null)} disabled={salvando} aria-label="Cancelar"><X className="size-3.5" /></Botao>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                          <Botao tamanho="sm" variante="fantasma" title="Editar" aria-label={`Editar ${f.nome}`}
                            onClick={() => setEdicao({ id: f.id, nome: f.nome, administradora: f.administradora_id ? String(f.administradora_id) : '', tipo: f.tipo, gestor: f.gestor ?? '' })}>
                            <Pencil className="size-3.5" />
                          </Botao>
                          <Botao tamanho="sm" variante="fantasma" title="Excluir" aria-label={`Excluir ${f.nome}`} onClick={() => pedirExclusao(f)}><Trash2 className="size-3.5" /></Botao>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dados && total > POR_PAGINA && (
        <div className="mt-4 flex items-center justify-between border-t border-dashed border-slate-300 pt-4 dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">Página {pagina} de {paginas}</p>
          <div className="flex gap-2">
            <Botao tamanho="sm" onClick={() => irPara(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior"><ChevronLeft className="size-4" /></Botao>
            <Botao tamanho="sm" onClick={() => irPara(pagina + 1)} disabled={pagina >= paginas} aria-label="Próxima página"><ChevronRight className="size-4" /></Botao>
          </div>
        </div>
      )}

      <Dialogo
        aberto={!!exclusao}
        titulo="Excluir fundo"
        onFechar={() => !excluindo && setExclusao(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setExclusao(null)} disabled={excluindo}>Cancelar</Botao>
          <Botao variante="perigo" onClick={excluir} disabled={excluindo}><Trash2 className="size-4" /> {excluindo ? 'Excluindo…' : 'Excluir fundo'}</Botao>
        </>}
      >
        {exclusao && (
          <div className="space-y-3 text-sm">
            <p>Excluir <b>{exclusao.fundo.nome}</b> ({formatarCpfCnpj(exclusao.fundo.cnpj)}) do cadastro?</p>
            <p className="font-serif text-slate-600 dark:text-slate-400">
              As bases do fundo continuam funcionando: elas guardam o nome e o CNPJ do fundo, só deixam de estar ligadas ao cadastro.
              {exclusao.uso && exclusao.uso.bases > 0 && <> Este fundo tem <b>{exclusao.uso.bases}</b> {exclusao.uso.bases === 1 ? 'base' : 'bases'}.</>}
            </p>
            {exclusao.uso && exclusao.uso.amostragens > 0 && (
              <Aviso tipo="alerta">As {exclusao.uso.amostragens} amostra(s) sorteada(s) deste fundo em Gestão › Amostra também serão apagadas.</Aviso>
            )}
          </div>
        )}
      </Dialogo>
    </Secao>
  );
}
