'use client';

import { useMemo, useState, type ReactNode } from 'react';
import JSZip from 'jszip';
import { AlertTriangle, Check, CheckCircle2, Download, Layers, Loader2, MinusCircle, Trash2, X } from 'lucide-react';
import { Aviso, Botao, cx } from '@/components/ui';
import { ErroApi } from '@/lib/cliente';
import { amostraApi, salvarArquivo, type FundoAmostra } from '@/lib/cliente/amostra';
import {
  amostraDoPeriodo, anteriorDoHistorico, fundosParecidos, juntar, mascaraCnpj, montarLote, regraSugerida, resumoCsv,
  type ConteudoLido, type SituacaoLote,
} from '@/lib/amostra/arquivos';
import { Bloco, Campo, Contagem, DICA, LinhaArquivo, Opcoes, ZonaArquivos, dataBr, inteiro, type Mensagem } from './comum';

type Situacao = SituacaoLote & { estado: 'gerando' | 'gerada' | 'pulada' | 'erro'; amostra?: { id?: number; seed: string; total_titulos: number; contagem?: Record<string, number> } | null };

const ESTILO: Record<Situacao['estado'], { icone: ReactNode; cor: string }> = {
  gerando: { icone: <Loader2 className="size-3.5 animate-spin" />, cor: 'text-indigo-700 dark:text-indigo-300' },
  gerada: { icone: <CheckCircle2 className="size-3.5" />, cor: 'text-emerald-700 dark:text-emerald-400' },
  pulada: { icone: <MinusCircle className="size-3.5" />, cor: 'text-slate-600 dark:text-slate-400' },
  erro: { icone: <AlertTriangle className="size-3.5" />, cor: 'text-rose-600 dark:text-rose-400' },
};
const FILTROS = [
  { valor: 'todos', rotulo: 'Todos' }, { valor: 'agerar', rotulo: 'A gerar' }, { valor: 'gerada', rotulo: 'Geradas' },
  { valor: 'pulada', rotulo: 'Puladas' }, { valor: 'erro', rotulo: 'Com erro' },
] as const;
type Filtro = (typeof FILTROS)[number]['valor'];
const grupoDa = (s: Situacao | undefined): Filtro => (!s || s.estado === 'gerando' ? 'agerar' : s.estado);
const numero = (t: string) => Math.max(0, parseInt(t, 10) || 0);

/** Aba "Em lote" (GerarEmLote.jsx do Bate Lastro): vários fundos de uma vez, cada um com a sua seed. */
export function GerarEmLote({ fundos, periodoPadrao }: { fundos: FundoAmostra[]; periodoPadrao: { dataDe: string; dataAte: string } }) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [dataDe, setDataDe] = useState(periodoPadrao.dataDe);
  const [dataAte, setDataAte] = useState(periodoPadrao.dataAte);
  const [regraEscolhida, setRegraEscolhida] = useState<'padrao' | 'planner' | null>(null);
  const [limiteAdquiridos, setLimiteAdquiridos] = useState(120);
  const [limiteVencidos, setLimiteVencidos] = useState(120);
  const [ajustes, setAjustes] = useState<Record<number, { adquiridos: number; vencidos: number }>>({});
  const [situacoes, setSituacoes] = useState<Record<number, Situacao>>({});
  const [chaveSituacoes, setChaveSituacoes] = useState('');
  const [gerando, setGerando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [conteudos, setConteudos] = useState<Map<File, ConteudoLido>>(() => new Map());
  const [escolhas, setEscolhas] = useState<Map<File, number>>(() => new Map());
  const [marcados, setMarcados] = useState<Map<File, number>>(() => new Map());
  const [lendo, setLendo] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  const fundosLote = useMemo(() => fundos.map((f) => ({ id: f.id, nome: f.nome, cnpj: f.cnpj, administradora: f.administradora })), [fundos]);
  const { linhas, semFundo, naoReconhecidos, pelaLeitura } = useMemo(
    () => montarLote(arquivos, fundosLote, { conteudos, escolhas }), [arquivos, fundosLote, conteudos, escolhas]);
  const regra = regraEscolhida ?? regraSugerida(linhas) ?? 'padrao';
  // Outro período ou regra é outro lote: o resultado na tela deixa de valer.
  const chaveAtual = `${dataDe}|${dataAte}|${regra}`;
  const situacoesValidas = chaveSituacoes === chaveAtual ? situacoes : {};

  /** Lê o fundo escrito dentro dos arquivos que não se identificam pelo nome. */
  const adicionar = async (novos: File[]) => {
    const todos = juntar(arquivos, novos);
    setArquivos(todos);
    const faltam = montarLote(todos, fundosLote, { conteudos, escolhas }).semFundo.filter((a) => !conteudos.has(a));
    if (!faltam.length) return;
    setLendo(true);
    try {
      const { arquivos: lidos } = await amostraApi.inspecionar(faltam, false);
      setConteudos((atual) => {
        const novo = new Map(atual);
        faltam.forEach((a, i) => novo.set(a, { nome: lidos[i]?.fundo_nome ?? null, cnpj: lidos[i]?.fundo_cnpj ?? null }));
        return novo;
      });
    } catch {
      setConteudos((atual) => {
        const novo = new Map(atual);
        faltam.forEach((a) => novo.set(a, { nome: null, cnpj: null }));
        return novo;
      });
    } finally {
      setLendo(false);
    }
  };

  const limitesDo = (id: number) => ajustes[id] ?? { adquiridos: limiteAdquiridos, vencidos: limiteVencidos };
  const remover = (lista: File[]) => setArquivos((atual) => atual.filter((a) => !lista.includes(a)));
  const limparTudo = () => {
    setArquivos([]);
    setEscolhas(new Map());
    setAjustes({});
    setSituacoes({});
  };

  const aGerar = linhas.filter((l) => l.estoques.length && situacoesValidas[l.fundo.id]?.estado !== 'gerada');
  const geradas = linhas.filter((l) => situacoesValidas[l.fundo.id]?.estado === 'gerada');
  const falta = [
    lendo && 'esperar a leitura dos arquivos sem CNPJ no nome',
    !linhas.length && !lendo && 'enviar os estoques dos fundos',
    dataDe > dataAte && 'corrigir o período (início depois do fim)',
    linhas.length > 0 && !aGerar.length && !geradas.length && 'enviar o estoque de algum fundo (só há liquidados)',
  ].filter(Boolean) as string[];

  const gerarLote = async () => {
    if (falta.length) return;
    setGerando(true);
    setMensagem(null);
    setChaveSituacoes(chaveAtual);
    let acumulado: Record<number, Situacao> = chaveSituacoes === chaveAtual ? { ...situacoes } : {};
    const por = (id: number, s: Situacao) => {
      acumulado = { ...acumulado, [id]: s };
      setSituacoes(acumulado);
    };
    for (const linha of aGerar) {
      const { fundo } = linha;
      por(fundo.id, { estado: 'gerando', rotulo: 'Gerando' });
      try {
        const historico = (await amostraApi.listar(fundo.id)).items;
        const existente = amostraDoPeriodo(historico, dataDe, dataAte);
        if (existente) {
          por(fundo.id, { estado: 'pulada', rotulo: 'Pulada', amostra: existente, mensagem: `Já tem amostra valendo neste período (seed ${existente.seed}).` });
          continue;
        }
        const anterior = regra === 'padrao' ? anteriorDoHistorico(historico, dataDe) : null;
        const lim = limitesDo(fundo.id);
        const amostra = await amostraApi.gerar({
          fundoId: fundo.id, dataDe, dataAte, regra, limiteAdquiridos: lim.adquiridos, limiteVencidos: lim.vencidos,
          estoques: linha.estoques, liquidados: regra === 'planner' ? [] : linha.liquidados, amostraAnteriorId: anterior?.id ?? null,
        });
        por(fundo.id, { estado: 'gerada', rotulo: 'Gerada', amostra, mensagem: anterior ? `Amostra anterior: ${dataBr(anterior.data_de)} a ${dataBr(anterior.data_ate)}.` : '' });
      } catch (e) {
        const detalhe = e instanceof ErroApi ? e.message : 'Não foi possível gerar a amostra.';
        // 409 = conflito com amostra valendo (mesmo estoque em período que se sobrepõe): o lote não descarta nada.
        por(fundo.id, e instanceof ErroApi && e.status === 409 ? { estado: 'pulada', rotulo: 'Pulada', mensagem: detalhe } : { estado: 'erro', rotulo: 'Erro', mensagem: detalhe });
      }
    }
    setGerando(false);
  };

  const baixarZip = async () => {
    setBaixando(true);
    try {
      const zip = new JSZip();
      for (const { fundo } of geradas) {
        const id = situacoesValidas[fundo.id].amostra?.id;
        if (!id) continue;
        const { nome, blob } = await amostraApi.arquivo(id, 'amostra');
        zip.file(nome, blob);
      }
      zip.file('resumo_do_lote.csv', resumoCsv(linhas, situacoesValidas));
      salvarArquivo(await zip.generateAsync({ type: 'blob' }), `Amostras_lote_${dataAte.replace(/-/g, '')}.zip`);
    } catch {
      setMensagem({ tipo: 'erro', texto: 'Não foi possível montar o .zip das amostras. Tente de novo.' });
    } finally {
      setBaixando(false);
    }
  };

  const resumo = Object.values(situacoesValidas).reduce<Record<string, number>>((c, s) => ({ ...c, [s.estado]: (c[s.estado] ?? 0) + 1 }), {});
  const porGrupo = linhas.reduce<Record<string, number>>((c, l) => {
    const g = grupoDa(situacoesValidas[l.fundo.id]);
    return { ...c, [g]: (c[g] ?? 0) + 1 };
  }, { todos: linhas.length });
  const visiveis = filtro === 'todos' ? linhas : linhas.filter((l) => grupoDa(situacoesValidas[l.fundo.id]) === filtro);

  return (
    <section className="lastro-cartao space-y-7 p-6">
      {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}
      <Bloco titulo="Estoques dos fundos">
        <ZonaArquivos titulo="Estoques e liquidados de vários fundos" multiplo onArquivos={(n) => void adicionar(n)}
          onRecusados={(n) => setMensagem({ tipo: 'erro', texto: `Envie só CSV ou XLSX. Ficaram de fora: ${n.join(', ')}` })} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className={cx(DICA, 'max-w-3xl')}>
            Envie o estoque e, se houver, a liquidação de cada fundo; cada arquivo vai para o fundo pelo CNPJ no nome ou, sem ele, pelo
            fundo escrito dentro do arquivo. Outros arquivos ficam de fora. Da liquidação entram só as recompras, nos Maiores Cedentes.
            Cada fundo ganha a sua seed.
          </p>
          {arquivos.length > 0 && <Botao tamanho="sm" disabled={gerando} onClick={limparTudo}><Trash2 className="size-3.5" /> Limpar todos</Botao>}
        </div>
        {naoReconhecidos.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="size-4" /> Não é estoque nem liquidação: fica fora do lote</p>
            <p className={DICA}>O nome do estoque precisa ter &quot;Estoque&quot; (ou &quot;Conciliação&quot;); o da liquidação, &quot;Liquidados&quot; ou &quot;Movimentações&quot;.</p>
            {naoReconhecidos.map((a) => <LinhaArquivo key={`${a.name}-${a.size}`} arquivo={a} onRemover={() => remover([a])} />)}
          </div>
        )}
        {lendo && <p className={cx(DICA, 'flex items-center gap-1.5')}><Loader2 className="size-3.5 animate-spin" /> Lendo os arquivos sem CNPJ no nome para achar o fundo…</p>}
        {!lendo && semFundo.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="size-4" /> Sem fundo correspondente: escolha o fundo ou tire o arquivo</p>
            <p className={DICA}>Nem o nome do arquivo nem o que vem escrito nele levam a um fundo cadastrado (ou levam a mais de um).</p>
            {semFundo.map((a) => {
              const nomeLido = conteudos.get(a)?.nome;
              const opcoes = fundosParecidos(nomeLido, fundosLote);
              return (
                <LinhaArquivo key={`${a.name}-${a.size}`} arquivo={a} onRemover={() => remover([a])}>
                  <div className="mt-2 space-y-1.5 pl-7">
                    <p className={DICA}>{nomeLido ? `No arquivo: ${nomeLido}` : 'O arquivo não traz o nome do fundo.'}</p>
                    <div className="flex max-w-2xl items-center gap-2">
                      <select className="lastro-campo h-9 min-w-0 flex-1 px-2 text-sm" aria-label={`Fundo de ${a.name}`} value={marcados.get(a) ?? ''}
                        onChange={(e) => setMarcados((m) => { const n = new Map(m); if (e.target.value) n.set(a, Number(e.target.value)); else n.delete(a); return n; })}>
                        <option value="">Escolher o fundo deste arquivo…</option>
                        {opcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                      </select>
                      <Botao tamanho="sm" disabled={!marcados.has(a)} onClick={() => { setEscolhas((m) => new Map(m).set(a, marcados.get(a)!)); setMarcados((m) => { const n = new Map(m); n.delete(a); return n; }); }}>
                        <Check className="size-3.5" /> Confirmar
                      </Botao>
                    </div>
                  </div>
                </LinhaArquivo>
              );
            })}
          </div>
        )}
      </Bloco>

      <Bloco titulo="Período, regra e limites">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Campo rotulo="Data de início" id="lote-de"><input id="lote-de" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} className="lastro-campo h-10 w-full px-3 text-sm" /></Campo>
          <Campo rotulo="Data fim" id="lote-ate"><input id="lote-ate" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} className={cx('lastro-campo h-10 w-full px-3 text-sm', dataDe > dataAte && '!border-rose-500')} /></Campo>
          <Campo rotulo="Limite de adquiridos" id="lote-adq"><input id="lote-adq" type="number" min={0} value={limiteAdquiridos} onChange={(e) => setLimiteAdquiridos(numero(e.target.value))} className="lastro-campo h-10 w-full px-3 text-sm" /></Campo>
          <Campo rotulo="Limite de vencidos" id="lote-venc"><input id="lote-venc" type="number" min={0} value={limiteVencidos} onChange={(e) => setLimiteVencidos(numero(e.target.value))} className="lastro-campo h-10 w-full px-3 text-sm" /></Campo>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="lastro-rotulo">Regra</span>
          <Opcoes rotulo="Regra do lote" valor={regra} onChange={setRegraEscolhida} opcoes={[{ valor: 'padrao', rotulo: 'Padrão' }, { valor: 'planner', rotulo: 'Planner' }]} />
          <span className={DICA}>
            {regra === 'padrao' ? 'A amostra anterior de cada fundo vem do histórico: a última valendo antes do início.' : 'Planner: sem maiores cedentes nem liquidados, com as pendências dos bates anteriores.'}
            {!regraEscolhida && linhas.length > 0 && ' (sugerida pela administradora dos fundos)'}
          </span>
        </div>
      </Bloco>

      {linhas.length > 0 && (
        <div className="space-y-3">
          <Opcoes rotulo="Filtrar fundos por situação" valor={filtro} onChange={setFiltro} opcoes={FILTROS.map((f) => ({ valor: f.valor, rotulo: `${f.rotulo} (${porGrupo[f.valor] ?? 0})` }))} />
          <div className="max-h-[32rem] overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                  {['Fundo', 'Arquivos', 'Adquiridos', 'Vencidos', 'Situação', ''].map((h) => <th key={h} className="lastro-rotulo px-4 py-3 text-slate-500 dark:text-slate-400">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {!visiveis.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum fundo nesta situação.</td></tr>}
                {visiveis.map((linha) => {
                  const { fundo } = linha;
                  const s = situacoesValidas[fundo.id];
                  const lim = limitesDo(fundo.id);
                  const doFundo = [...linha.estoques, ...linha.liquidados];
                  return (
                    <tr key={fundo.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                      <td className="px-4 py-3">
                        <p className="font-medium">{fundo.nome}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{mascaraCnpj(fundo.cnpj)}{fundo.administradora ? ` · ${fundo.administradora}` : ''}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">
                        {linha.estoques.length} {linha.estoques.length === 1 ? 'estoque' : 'estoques'}
                        {linha.liquidados.length > 0 && <div className="text-xs">{linha.liquidados.length} de liquidados{regra === 'planner' ? ' (não entram no Planner)' : ''}</div>}
                        {doFundo.some((a) => pelaLeitura.has(a)) && <div className="text-xs">pelo fundo escrito no arquivo</div>}
                        {doFundo.some((a) => escolhas.has(a)) && (
                          <div className="text-xs">escolhido à mão · <button type="button" disabled={gerando} className="underline hover:text-slate-900 dark:hover:text-white"
                            onClick={() => setEscolhas((m) => { const n = new Map(m); doFundo.forEach((a) => n.delete(a)); return n; })}>desfazer</button></div>
                        )}
                        {!linha.estoques.length && <div className="text-xs text-amber-700 dark:text-amber-400">falta o estoque</div>}
                      </td>
                      {(['adquiridos', 'vencidos'] as const).map((campo) => (
                        <td key={campo} className="px-4 py-3">
                          <input type="number" min={0} value={lim[campo]} disabled={regra === 'planner' || gerando} aria-label={`Limite de ${campo} de ${fundo.nome}`}
                            onChange={(e) => setAjustes((a) => ({ ...a, [fundo.id]: { ...limitesDo(fundo.id), [campo]: numero(e.target.value) } }))}
                            className="lastro-campo h-9 w-24 px-2 text-sm" />
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {s ? (
                          <div className={cx('text-xs', ESTILO[s.estado].cor)}>
                            <p className="flex items-center gap-1 font-semibold">{ESTILO[s.estado].icone}{s.rotulo}
                              {s.amostra && s.estado === 'gerada' && <span className="font-mono font-normal">· {s.amostra.seed}</span>}</p>
                            {s.estado === 'gerada' && s.amostra && <p className="text-slate-600 dark:text-slate-400">{inteiro(s.amostra.total_titulos)} títulos · <Contagem contagem={s.amostra.contagem} /></p>}
                            {s.mensagem && <p className="max-w-xs text-slate-600 dark:text-slate-400">{s.mensagem}</p>}
                          </div>
                        ) : <span className="text-xs text-slate-500 dark:text-slate-400">A gerar</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!gerando && s?.estado !== 'gerada' && (
                          <button type="button" aria-label={`Tirar ${fundo.nome} do lote`} onClick={() => remover(doFundo)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><X className="size-4" /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-dashed border-slate-300 pt-5 md:flex-row md:items-center md:justify-between dark:border-slate-700">
        <div className="text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
          {falta.length ? <p>Falta {falta[0]}.</p> : (
            <p>
              {linhas.length} {linhas.length === 1 ? 'fundo' : 'fundos'} · {dataBr(dataDe)} a {dataBr(dataAte)}
              {resumo.gerada ? ` · ${resumo.gerada} geradas` : ''}{resumo.pulada ? ` · ${resumo.pulada} puladas` : ''}{resumo.erro ? ` · ${resumo.erro} com erro` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {geradas.length > 0 && (
            <Botao onClick={baixarZip} disabled={baixando || gerando}>
              {baixando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Baixar as {geradas.length} amostras (.zip)
            </Botao>
          )}
          <Botao variante="primario" onClick={gerarLote} disabled={gerando || falta.length > 0 || !aGerar.length}>
            {gerando ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
            {gerando ? 'Gerando o lote…' : aGerar.length === 1 ? 'Gerar 1 amostra' : aGerar.length ? `Gerar ${aGerar.length} amostras` : 'Gerar amostras'}
          </Botao>
        </div>
      </div>
    </section>
  );
}
