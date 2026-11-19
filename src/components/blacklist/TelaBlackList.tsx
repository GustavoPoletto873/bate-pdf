'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { Aviso, Botao, Dialogo, Etiqueta, cx } from '@/components/ui';
import { Secao, Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { ErroApi } from '@/lib/cliente';
import { blacklistApi, type EntradaComOcorrencias, type OcorrenciaFundo } from '@/lib/cliente/blacklist';
import { formatarCpfCnpj } from '@/lib/texto';
import { interpretarLista, LIMITE_LOTE } from './lista';

const moeda = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percentual = (v: number) => `${(Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const inteiro = (v: number) => Number(v || 0).toLocaleString('pt-BR');
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const papeis = (ced: number, sac: number) => [ced ? 'Cedente' : null, sac ? 'Sacado' : null].filter(Boolean).join(' / ');
type Mensagem = { tipo: 'ok' | 'erro' | 'alerta'; texto: string } | null;

function TabelaBases({ linhas }: { linhas: OcorrenciaFundo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left dark:border-slate-700">
            {['Fundo', 'Data-base', 'Papel', 'Linhas', 'Valor nominal', 'Valor de aquisição', '% nominal da base', '% aquisição da base'].map((h, i) => (
              <th key={h} className={cx('lastro-rotulo px-2 py-2 text-slate-500 dark:text-slate-400', i >= 3 && 'text-right')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((f) => (
            <tr key={`${f.fundo_chave}-${f.base_id}`} className="border-b border-slate-100 dark:border-slate-800">
              <td className="px-2 py-2.5"><div className="font-medium">{f.nome_fundo || '—'}</div>{f.cnpj_fundo && <div className="text-xs text-slate-500 dark:text-slate-400">{formatarCpfCnpj(f.cnpj_fundo)}</div>}</td>
              <td className="px-2 py-2.5 text-slate-700 dark:text-slate-300">{dataBr(f.data_referencia)}</td>
              <td className="px-2 py-2.5 text-slate-700 dark:text-slate-300">{papeis(f.linhas_cedente, f.linhas_sacado)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{inteiro(f.linhas)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{moeda(f.valor_nominal)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{moeda(f.valor_presente)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{percentual(f.percentual_nominal)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{percentual(f.percentual_presente)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-[110px]">
      <div className="lastro-rotulo text-[10px] text-slate-500 dark:text-slate-400">{rotulo}</div>
      <div className="text-sm font-semibold tabular-nums">{valor}</div>
    </div>
  );
}

function CartaoEntrada({ entrada, onRemover }: { entrada: EntradaComOcorrencias; onRemover: (e: EntradaComOcorrencias) => void }) {
  const [aberto, setAberto] = useState(false);
  const [historico, setHistorico] = useState<OcorrenciaFundo[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const oc = entrada.ocorrencias;
  const tem = oc.total_linhas > 0;

  const verHistorico = async () => {
    setCarregando(true);
    setErro(null);
    try {
      setHistorico((await blacklistApi.historico(entrada.id)).bases);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar o histórico.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className={cx('rounded-2xl border-2', tem ? 'border-rose-400 dark:border-rose-500/50' : 'border-slate-200 dark:border-slate-700')}>
      <div className="flex items-start gap-3 p-4">
        <button type="button" aria-label={aberto ? 'Recolher' : 'Expandir'} aria-expanded={aberto} disabled={!tem} onClick={() => setAberto((v) => !v)}
          className="mt-0.5 text-slate-600 disabled:opacity-30 dark:text-slate-300">
          {aberto ? <ChevronDown className="size-5" /> : <ChevronRight className="size-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-display text-base tracking-tight">
              {entrada.nome}
              {tem && <span className="text-rose-700 dark:text-rose-300"> — {oc.total_fundos} {oc.total_fundos === 1 ? 'fundo' : 'fundos'}</span>}
            </h3>
            <span className="text-xs text-slate-600 dark:text-slate-400">{entrada.tipo_documento} {entrada.documento_formatado}</span>
            {oc.novas_7d > 0 && <Etiqueta cor="amber">{oc.novas_7d} {oc.novas_7d === 1 ? 'nova' : 'novas'} na semana</Etiqueta>}
          </div>
          {tem ? (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
              <Numero rotulo="Linhas" valor={inteiro(oc.total_linhas)} />
              <Numero rotulo="Figura como" valor={papeis(oc.linhas_cedente, oc.linhas_sacado)} />
              <Numero rotulo="Valor nominal" valor={moeda(oc.valor_nominal)} />
              <Numero rotulo="Valor de aquisição" valor={moeda(oc.valor_presente)} />
              <Numero rotulo="% nominal da base" valor={percentual(oc.percentual_nominal)} />
              <Numero rotulo="% aquisição da base" valor={percentual(oc.percentual_presente)} />
            </div>
          ) : <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Monitorando — nenhuma ocorrência nas bases atuais.</p>}
        </div>
        <Botao variante="fantasma" tamanho="sm" aria-label={`Remover ${entrada.nome}`} title="Remover da BlackList" onClick={() => onRemover(entrada)}><Trash2 className="size-4" /></Botao>
      </div>
      {aberto && tem && (
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">Base mais recente de cada fundo. O valor de aquisição faz o papel do valor presente, como no Bate Lastro.</p>
          <TabelaBases linhas={oc.fundos} />
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {historico === null ? (
            <Botao tamanho="sm" onClick={verHistorico} disabled={carregando}>{carregando && <Loader2 className="size-3.5 animate-spin" />} Ver histórico em todas as bases</Botao>
          ) : (
            <div>
              <h4 className="lastro-rotulo mb-1 text-slate-500 dark:text-slate-400">Histórico — todas as bases</h4>
              <TabelaBases linhas={historico} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Gestão › BlackList (BlackList.jsx do Bate Lastro). */
export function TelaBlackList() {
  const [entradas, setEntradas] = useState<EntradaComOcorrencias[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  const [modoLote, setModoLote] = useState(false);
  const [textoLote, setTextoLote] = useState('');
  const [reprocessando, setReprocessando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [removendo, setRemovendo] = useState<EntradaComOcorrencias | null>(null);

  const carregar = async () => {
    try {
      setEntradas((await blacklistApi.listar()).items);
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível carregar a BlackList.' });
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    let ativo = true;
    blacklistApi.listar()
      .then((r) => { if (ativo) setEntradas(r.items); })
      .catch(() => { if (ativo) setMensagem({ tipo: 'erro', texto: 'Não foi possível carregar a BlackList. Confira se o Lastro está rodando e recarregue a página.' }); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  const adicionar = async (e: FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setMensagem(null);
    try {
      await blacklistApi.criar(nome, documento);
      setMensagem({ tipo: 'ok', texto: 'Adicionado à BlackList. O histórico das bases já foi conferido.' });
      setNome('');
      setDocumento('');
      await carregar();
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof ErroApi ? err.message : 'Não foi possível cadastrar.' });
    } finally {
      setSalvando(false);
    }
  };

  const itensLote = useMemo(() => interpretarLista(textoLote), [textoLote]);
  const importarLote = async () => {
    if (!itensLote.length) return;
    if (itensLote.length > LIMITE_LOTE) {
      setMensagem({ tipo: 'erro', texto: `Máximo de ${LIMITE_LOTE} linhas por vez. Divida a lista e importe em partes.` });
      return;
    }
    setSalvando(true);
    setMensagem(null);
    try {
      const { criados, erros } = await blacklistApi.criarLote(itensLote);
      if (erros.length) {
        setMensagem({
          tipo: criados.length ? 'alerta' : 'erro',
          texto: `${criados.length ? `${criados.length} adicionados. ` : ''}${erros.length} não importados: ${erros.slice(0, 3).map((x) => `linha ${x.linha} — ${x.nome || x.documento} (${x.erro})`).join('; ')}${erros.length > 3 ? '…' : ''}`,
        });
      } else {
        setMensagem({ tipo: 'ok', texto: `${criados.length} adicionados à BlackList.` });
        setTextoLote('');
        setModoLote(false);
      }
      await carregar();
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof ErroApi ? err.message : 'Não foi possível importar a lista.' });
    } finally {
      setSalvando(false);
    }
  };

  const confirmarRemocao = async () => {
    if (!removendo) return;
    try {
      await blacklistApi.remover(removendo.id);
      setMensagem({ tipo: 'ok', texto: `${removendo.nome} saiu da BlackList.` });
      setRemovendo(null);
      await carregar();
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof ErroApi ? err.message : 'Não foi possível remover.' });
    }
  };

  const reprocessar = async () => {
    setReprocessando(true);
    try {
      const r = await blacklistApi.reprocessar();
      setMensagem({ tipo: 'ok', texto: r.ocorrencias ? `Reprocessado: ${r.ocorrencias} ocorrências novas.` : 'Reprocessado: nenhuma ocorrência nova.' });
      await carregar();
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof ErroApi ? err.message : 'Não foi possível reprocessar.' });
    } finally {
      setReprocessando(false);
    }
  };

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return entradas;
    const d = termo.replace(/\D/g, '');
    return entradas.filter((e) => e.nome.toLowerCase().includes(termo) || (d && e.documento.includes(d)));
  }, [entradas, busca]);
  const comOcorrencia = entradas.filter((e) => e.ocorrencias.total_linhas > 0).length;

  return (
    <div className="space-y-6">
      {mensagem && (
        <div className="flex items-start gap-2">
          <div className="flex-1"><Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso></div>
          <Botao variante="fantasma" tamanho="sm" onClick={() => setMensagem(null)} aria-label="Fechar aviso"><X className="size-4" /></Botao>
        </div>
      )}

      <Secao titulo="Cadastro" acoes={<Botao tamanho="sm" variante="fantasma" onClick={() => setModoLote((v) => !v)}><Upload className="size-4" /> {modoLote ? 'Cadastro individual' : 'Importar lista'}</Botao>}>
        {!modoLote ? (
          <form onSubmit={adicionar} className="grid grid-cols-1 items-end gap-4 md:grid-cols-[2fr_1fr_auto]">
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold">Nome</span>
              <input className="lastro-campo h-10 w-full px-3 text-sm" value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Razão social ou nome da pessoa" />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-semibold">CPF / CNPJ</span>
              <input className="lastro-campo h-10 w-full px-3 text-sm" value={documento} onChange={(e) => setDocumento(e.target.value)} required placeholder="000.000.000-00 ou 00.000.000/0000-00" />
            </label>
            <button type="submit" disabled={salvando} className="lastro-botao lastro-botao-md lastro-botao-primario">
              {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Adicionar
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold">Uma entidade por linha: nome e documento separados por tab ou ponto e vírgula (cole direto do Excel)</span>
              <textarea rows={8} value={textoLote} onChange={(e) => setTextoLote(e.target.value)} className="lastro-campo w-full px-3 py-2 font-mono text-sm"
                placeholder={'EMPRESA FICTÍCIA LTDA;11.222.333/0001-81\nFULANO DE TAL;123.456.789-09'} />
            </label>
            <div className="flex items-center justify-between gap-4">
              <span className={cx('text-sm', itensLote.length > LIMITE_LOTE ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400')}>
                {itensLote.length} {itensLote.length === 1 ? 'linha reconhecida' : 'linhas reconhecidas'}{itensLote.length > LIMITE_LOTE && ` (máximo ${LIMITE_LOTE})`}
              </span>
              <Botao variante="primario" onClick={importarLote} disabled={salvando || !itensLote.length}>
                {salvando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Importar
              </Botao>
            </div>
          </div>
        )}
      </Secao>

      <Secao
        titulo="Entidades monitoradas"
        descricao={`${entradas.length} ${entradas.length === 1 ? 'entidade' : 'entidades'} · ${comOcorrencia} com ocorrência na base mais recente de algum fundo`}
        acoes={(
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou documento…" aria-label="Buscar na BlackList" className="lastro-campo h-9 w-64 pl-9 pr-3 text-sm" />
            </div>
            <Botao onClick={reprocessar} disabled={reprocessando} title="Confere todas as entidades contra todas as bases de novo">
              <RefreshCw className={cx('size-4', reprocessando && 'animate-spin')} /> Reprocessar
            </Botao>
          </div>
        )}
      >
        <div className="space-y-3">
          {carregando ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="size-5 animate-spin" /> Carregando a BlackList…</p>
          ) : !filtradas.length ? (
            <Vazio icone={<IconeRabisco tipo="lupa" tamanho={44} />} titulo={busca ? 'Nenhuma entidade encontrada' : 'Nenhuma entidade cadastrada ainda'}>
              {busca ? 'Confira o nome ou o documento digitado.' : 'Cadastre acima o cedente ou sacado que deve ser monitorado. Nada é bloqueado: o Lastro só avisa quando ele aparece numa base.'}
            </Vazio>
          ) : filtradas.map((e) => <CartaoEntrada key={e.id} entrada={e} onRemover={setRemovendo} />)}
        </div>
      </Secao>

      <Dialogo aberto={!!removendo} titulo="Remover da BlackList" onFechar={() => setRemovendo(null)}
        rodape={<><Botao onClick={() => setRemovendo(null)}>Cancelar</Botao><Botao variante="perigo" onClick={confirmarRemocao}>Remover</Botao></>}>
        <p className="text-sm">Remover <strong>{removendo?.nome}</strong> da BlackList? O monitoramento dessa entidade será encerrado.</p>
      </Dialogo>
    </div>
  );
}
