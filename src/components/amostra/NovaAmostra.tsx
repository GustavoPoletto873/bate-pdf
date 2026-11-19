'use client';

import { Fragment, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2, Dices, Download, Loader2, Package, ShieldCheck, X } from 'lucide-react';
import { Aviso, Botao, Etiqueta, cx } from '@/components/ui';
import { Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { ErroApi } from '@/lib/cliente';
import { amostraApi, type DetalheAmostragem, type FundoAmostra, type ResumoAmostragem } from '@/lib/cliente/amostra';
import { alertaCnpj, juntar, periodosDaDataBase, recusados, separar } from '@/lib/amostra/arquivos';
import { Bloco, Campo, Contagem, DICA, LinhaArquivo, Opcoes, ZonaArquivos, dataBr, inteiro, type Mensagem } from './comum';

const numero = (t: string) => Math.max(0, parseInt(t, 10) || 0);
const assinaturaDe = (v: unknown[]) => JSON.stringify(v);
const listaArquivos = (a: File[]) => a.map((f) => `${f.name}:${f.size}`);

/** Aba "Nova amostra" (Amostra.jsx do Bate Lastro). */
export function NovaAmostra({ fundos, carregandoFundos, periodoPadrao }: {
  fundos: FundoAmostra[]; carregandoFundos: boolean; periodoPadrao: { dataDe: string; dataAte: string };
}) {
  const router = useRouter();
  const [fundoId, setFundoId] = useState<number | null>(null);
  const [dataDe, setDataDe] = useState(periodoPadrao.dataDe);
  const [dataAte, setDataAte] = useState(periodoPadrao.dataAte);
  const [periodoEditado, setPeriodoEditado] = useState(false);
  const [dataBase, setDataBase] = useState<string | null>(null);
  const [lendoDataBase, setLendoDataBase] = useState(false);
  const [limiteAdquiridos, setLimiteAdquiridos] = useState(120);
  const [limiteVencidos, setLimiteVencidos] = useState(120);
  const [regra, setRegra] = useState<'padrao' | 'planner'>('padrao');
  const [estoques, setEstoques] = useState<File[]>([]);
  const [liquidados, setLiquidados] = useState<File[]>([]);
  const [anteriorId, setAnteriorId] = useState<number | null>(null);
  const [anteriorArquivo, setAnteriorArquivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState('');
  const [conflito, setConflito] = useState<{ assinatura: string; texto: string } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [ultima, setUltima] = useState<DetalheAmostragem | null>(null);
  const [historico, setHistorico] = useState<ResumoAmostragem[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verificacoes, setVerificacoes] = useState<Record<number, { identica: boolean; divergencias: string[] }>>({});
  const [descartando, setDescartando] = useState<number | null>(null);
  const [motivoDescarte, setMotivoDescarte] = useState('');
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const leitura = useRef(0);

  const fundoAtual = fundos.find((f) => f.id === fundoId) ?? null;
  const assinatura = assinaturaDe([fundoId, dataDe, dataAte, limiteAdquiridos, limiteVencidos, regra, listaArquivos(estoques), listaArquivos(liquidados), anteriorId, anteriorArquivo?.name]);
  const precisaMotivo = conflito?.assinatura === assinatura;

  const carregarHistorico = async (id: number | null) => {
    if (!id) {
      setHistorico([]);
      return;
    }
    setCarregandoHistorico(true);
    try {
      setHistorico((await amostraApi.listar(id)).items);
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível carregar o histórico.' });
    } finally {
      setCarregandoHistorico(false);
    }
  };

  const trocarFundo = (id: number | null) => {
    setFundoId(id);
    setAnteriorId(null);
    setAnteriorArquivo(null);
    setUltima(null);
    setMotivo('');
    void carregarHistorico(id);
  };

  /** Data-base do estoque (a maior entre os arquivos), lida pelo mesmo leitor do sorteio. */
  const lerDataBase = async (lista: File[]) => {
    const pedido = ++leitura.current;
    if (!lista.length) {
      setDataBase(null);
      setLendoDataBase(false);
      return;
    }
    setLendoDataBase(true);
    try {
      const { arquivos } = await amostraApi.inspecionar(lista, true);
      if (pedido !== leitura.current) return;
      const maior = arquivos.map((a) => a.data_base).filter((d): d is string => !!d).sort().pop() ?? null;
      setDataBase(maior);
      if (maior && !periodoEditado) {
        const { sugerido } = periodosDaDataBase(maior);
        setDataDe(sugerido.dataDe);
        setDataAte(sugerido.dataAte);
      }
    } catch {
      if (pedido === leitura.current) setDataBase(null);
    } finally {
      if (pedido === leitura.current) setLendoDataBase(false);
    }
  };

  const adicionarArquivos = (novos: File[]) => {
    const fora = recusados(novos);
    if (fora.length) {
      setMensagem({ tipo: 'erro', texto: fora.length === 1 ? 'Arquivo recusado: o nome não indica estoque nem liquidação.' : `${fora.length} arquivos recusados: o nome não indica estoque nem liquidação.` });
    }
    const { estoques: e, liquidados: l } = separar(novos.filter((a) => !fora.includes(a)));
    const novosEstoques = juntar(estoques, e);
    setEstoques(novosEstoques);
    setLiquidados(juntar(liquidados, l));
    if (e.length) void lerDataBase(novosEstoques);
  };
  const removerEstoque = (arquivo: File) => {
    const lista = estoques.filter((a) => a !== arquivo);
    setEstoques(lista);
    void lerDataBase(lista);
  };

  const periodos = dataBase ? periodosDaDataBase(dataBase) : null;
  const aplicarPeriodo = (p: { dataDe: string; dataAte: string }) => {
    setDataDe(p.dataDe);
    setDataAte(p.dataAte);
    setPeriodoEditado(true);
  };
  const passaDaDataBase = !!dataBase && dataAte > dataBase;
  const anteriores = historico.filter((a) => a.status === 'GERADA' && a.data_ate < dataDe);
  const anteriorEscolhida = anteriores.find((a) => a.id === anteriorId) ?? null;
  const temAnterior = !!(anteriorArquivo || anteriorEscolhida);

  const falta = [
    !fundoId && 'escolher o fundo',
    !estoques.length && 'enviar o estoque',
    passaDaDataBase && `ajustar o período até a data-base do estoque (${dataBr(dataBase)})`,
    dataDe > dataAte && 'corrigir o período (início depois do fim)',
    precisaMotivo && !motivo.trim() && 'informar o motivo para sortear de novo',
  ].filter(Boolean) as string[];

  const gerar = async () => {
    if (falta.length || !fundoId) return;
    setGerando(true);
    setMensagem(null);
    try {
      const amostra = await amostraApi.gerar({
        fundoId, dataDe, dataAte, limiteAdquiridos, limiteVencidos, regra, estoques,
        liquidados: regra === 'planner' ? [] : liquidados,
        amostraAnteriorId: anteriorEscolhida?.id ?? null,
        amostraAnteriorArquivo: anteriorArquivo,
        motivo: precisaMotivo ? motivo.trim() : null,
      });
      setUltima(amostra);
      setConflito(null);
      setMotivo('');
      setMensagem({ tipo: 'ok', texto: `Amostra gerada: seed ${amostra.seed}.` });
      void carregarHistorico(fundoId);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 409 && !precisaMotivo) setConflito({ assinatura, texto: e.message });
      else setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível gerar a amostra. Tente de novo.' });
    } finally {
      setGerando(false);
    }
  };

  const verificar = async (a: ResumoAmostragem) => {
    setOcupado(`${a.id}:verificar`);
    try {
      const r = await amostraApi.verificar(a.id);
      setVerificacoes((v) => ({ ...v, [a.id]: r }));
      setMensagem(r.identica ? { tipo: 'ok', texto: 'Amostra refeita: idêntica à registrada.' } : { tipo: 'erro', texto: 'A amostra refeita não bate com a registrada. Veja as divergências no histórico.' });
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível verificar a amostra.' });
    } finally {
      setOcupado(null);
    }
  };

  const confirmarDescarte = async (a: ResumoAmostragem) => {
    if (!motivoDescarte.trim()) {
      setMensagem({ tipo: 'erro', texto: 'Informe o motivo do descarte.' });
      return;
    }
    setOcupado(`${a.id}:descartar`);
    try {
      await amostraApi.descartar(a.id, motivoDescarte.trim());
      setMensagem({ tipo: 'ok', texto: 'Amostra descartada. O registro continua no histórico.' });
      setDescartando(null);
      setMotivoDescarte('');
      if (ultima?.id === a.id) setUltima(null);
      void carregarHistorico(fundoId);
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível descartar a amostra.' });
    } finally {
      setOcupado(null);
    }
  };

  const usarComoBase = (a: ResumoAmostragem) => router.push(`/base?amostra=${a.id}`);
  const pendentesUltima = ultima?.contagem?.['Pendências'] ?? 0;

  return (
    <div className="space-y-6">
      {mensagem && (
        <div className="flex items-start gap-2">
          <div className="flex-1"><Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso></div>
          <Botao variante="fantasma" tamanho="sm" onClick={() => setMensagem(null)} aria-label="Fechar aviso"><X className="size-4" /></Botao>
        </div>
      )}

      <section className="lastro-cartao space-y-7 p-6">
        <Bloco titulo="Fundo">
          <select
            className="lastro-campo h-10 w-full max-w-xl px-3 text-sm"
            value={fundoId ?? ''}
            onChange={(e) => trocarFundo(e.target.value ? Number(e.target.value) : null)}
            aria-label="Fundo"
          >
            <option value="">{carregandoFundos ? 'Carregando fundos…' : fundos.length ? 'Selecione um fundo…' : 'Nenhum fundo cadastrado (Gestão › Fundos)'}</option>
            {fundos.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.administradora ? ` · ${f.administradora}` : ''}</option>)}
          </select>
        </Bloco>

        <Bloco titulo="Período e limites">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Campo rotulo="Data de início" id="amo-de">
              <input id="amo-de" type="date" value={dataDe} onChange={(e) => { setDataDe(e.target.value); setPeriodoEditado(true); }} className="lastro-campo h-10 w-full px-3 text-sm" />
            </Campo>
            <Campo rotulo="Data fim" id="amo-ate">
              <input id="amo-ate" type="date" value={dataAte} onChange={(e) => { setDataAte(e.target.value); setPeriodoEditado(true); }}
                className={cx('lastro-campo h-10 w-full px-3 text-sm', (dataDe > dataAte || passaDaDataBase) && '!border-rose-500')} />
            </Campo>
            <Campo rotulo="Limite de adquiridos" id="amo-adq">
              <input id="amo-adq" type="number" min={0} value={limiteAdquiridos} onChange={(e) => setLimiteAdquiridos(numero(e.target.value))} className="lastro-campo h-10 w-full px-3 text-sm" disabled={regra === 'planner'} />
            </Campo>
            <Campo rotulo="Limite de vencidos" id="amo-venc">
              <input id="amo-venc" type="number" min={0} value={limiteVencidos} onChange={(e) => setLimiteVencidos(numero(e.target.value))} className="lastro-campo h-10 w-full px-3 text-sm" disabled={regra === 'planner'} />
            </Campo>
          </div>
          <div className={DICA} aria-live="polite">
            {lendoDataBase && <p className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Lendo a data-base do estoque…</p>}
            {!lendoDataBase && periodos && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Data-base do estoque: <strong className="text-slate-800 dark:text-slate-100">{dataBr(dataBase)}</strong></span>
                <span aria-hidden>·</span><span>usar</span>
                <button type="button" onClick={() => aplicarPeriodo(periodos.mes)} className="font-medium underline underline-offset-2 hover:text-slate-900 dark:hover:text-white">
                  o mês ({dataBr(periodos.mes.dataDe)} a {dataBr(periodos.mes.dataAte)})
                </button>
                <span>ou</span>
                <button type="button" onClick={() => aplicarPeriodo(periodos.trimestre)} className="font-medium underline underline-offset-2 hover:text-slate-900 dark:hover:text-white">
                  o trimestre até a data-base ({dataBr(periodos.trimestre.dataDe)} a {dataBr(periodos.trimestre.dataAte)})
                </button>
              </p>
            )}
            {!lendoDataBase && passaDaDataBase && <p className="mt-1 text-rose-600 dark:text-rose-400">A data fim passa da data-base do estoque: o sorteio só pode ir até {dataBr(dataBase)}.</p>}
            {!lendoDataBase && !periodos && (
              <p>{estoques.length ? 'O estoque não informa a data-base (DATA_REFERENCIA): confira o período.' : 'Ao anexar o estoque, o período é ajustado pela data-base dele. Sem estoque, vale o último trimestre fechado.'}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="lastro-rotulo">Regra</span>
            <Opcoes rotulo="Regra da amostra" valor={regra} onChange={setRegra} opcoes={[{ valor: 'padrao', rotulo: 'Padrão' }, { valor: 'planner', rotulo: 'Planner' }]} />
            <span className={DICA}>
              {regra === 'padrao'
                ? '5 maiores cedentes (3 títulos cada) e sorteio de adquiridos e vencidos no período.'
                : 'Fundos Planner: adquiridos e vencidos juntos, até 120 títulos, sem maiores cedentes. Somam-se as pendências dos bates dos três trimestres anteriores, com uma aba por trimestre.'}
            </span>
          </div>
        </Bloco>

        <Bloco titulo="Arquivos">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold">Estoque e liquidados</p>
              <ZonaArquivos titulo="Estoque e liquidados do fundo" multiplo onArquivos={adicionarArquivos}
                onRecusados={(n) => setMensagem({ tipo: 'erro', texto: `Envie só CSV ou XLSX. Ficaram de fora: ${n.join(', ')}` })} />
              {estoques.length > 0 && <p className={cx(DICA, 'pt-1 font-semibold')}>Estoque</p>}
              {estoques.map((a) => (
                <LinhaArquivo key={`${a.name}-${a.size}`} arquivo={a} alertas={[alertaCnpj(a.name, fundoAtual)].filter(Boolean) as string[]} onRemover={() => removerEstoque(a)} />
              ))}
              {liquidados.length > 0 && <p className={cx(DICA, 'pt-1 font-semibold')}>Liquidados</p>}
              {liquidados.map((a) => (
                <LinhaArquivo key={`${a.name}-${a.size}`} arquivo={a}
                  alertas={[alertaCnpj(a.name, fundoAtual), regra === 'planner' ? 'Na regra Planner os liquidados não entram na amostra.' : null].filter(Boolean) as string[]}
                  onRemover={() => setLiquidados(liquidados.filter((x) => x !== a))} />
              ))}
              <p className={DICA}>Envie o estoque e, se houver, a liquidação do período; outros arquivos são recusados pelo nome. Da liquidação entram só as recompras, nos Maiores Cedentes (5 cedentes, 3 títulos cada).</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Amostra anterior <span className="font-normal text-slate-500 dark:text-slate-400">(opcional)</span></p>
              {anteriorArquivo
                ? <LinhaArquivo arquivo={anteriorArquivo} onRemover={() => setAnteriorArquivo(null)} />
                : <ZonaArquivos titulo="Amostra do trimestre anterior" onArquivos={([a]) => { setAnteriorArquivo(a); setAnteriorId(null); }} />}
              {anteriores.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className={DICA}>Ou use uma amostra já gerada para este fundo:</p>
                  <div role="radiogroup" aria-label="Amostras anteriores do fundo" className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                    {anteriores.map((a) => (
                      <label key={a.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <input type="radio" name="amo-anterior" checked={anteriorId === a.id} onChange={() => { setAnteriorId(a.id); setAnteriorArquivo(null); }} className="size-4 accent-indigo-600" />
                        <span className="font-medium">{dataBr(a.data_de)} a {dataBr(a.data_ate)}</span>
                        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">seed <span className="font-mono">{a.seed}</span> · {inteiro(a.total_titulos)} títulos</span>
                      </label>
                    ))}
                  </div>
                  {anteriorEscolhida && <button type="button" onClick={() => setAnteriorId(null)} className="text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">Não usar amostra anterior</button>}
                </div>
              )}
              <p className={DICA}>Os títulos da amostra anterior saem do grupo Maiores Cedentes.</p>
            </div>
          </div>
        </Bloco>

        {precisaMotivo && (
          <div className="space-y-2 rounded-xl border-2 border-amber-400 p-4 dark:border-amber-500/50">
            <label htmlFor="amo-motivo" className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-4" /> Já existe amostra valendo com este estoque
            </label>
            <p className={DICA}>{conflito?.texto}</p>
            <input id="amo-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: o estoque enviado estava incompleto" className="lastro-campo h-10 w-full px-3 text-sm" />
          </div>
        )}

        <div className="flex flex-col gap-4 border-t border-dashed border-slate-300 pt-5 md:flex-row md:items-center md:justify-between dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
            {falta.length ? <p>Falta {falta[0]}.</p> : (
              <p>
                <strong className="text-slate-800 dark:text-slate-100">{fundoAtual?.nome}</strong>
                {' · '}{dataBr(dataDe)} a {dataBr(dataAte)}
                {' · '}{regra === 'planner' ? 'regra Planner, com as pendências dos bates anteriores' : `até ${limiteAdquiridos} adquiridos e ${limiteVencidos} vencidos`}
                {' · '}{estoques.length} {estoques.length === 1 ? 'estoque' : 'estoques'}
                {regra !== 'planner' && liquidados.length > 0 && ` · ${liquidados.length} de liquidados`}
                {' · '}{temAnterior ? 'com amostra anterior' : 'sem amostra anterior'}
              </p>
            )}
          </div>
          <Botao variante="primario" onClick={gerar} disabled={gerando || falta.length > 0 || lendoDataBase}>
            {gerando ? <Loader2 className="size-4 animate-spin" /> : <Dices className="size-4" />}
            {gerando ? 'Sorteando…' : precisaMotivo ? 'Sortear de novo' : 'Gerar amostra'}
          </Botao>
        </div>
      </section>

      {ultima && (
        <section className="lastro-cartao space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg tracking-tight">
                {pendentesUltima
                  ? `${inteiro(ultima.total_titulos)} títulos: ${inteiro(ultima.total_titulos - pendentesUltima)} sorteados de ${inteiro(ultima.populacao_titulos)} e ${inteiro(pendentesUltima)} ${pendentesUltima === 1 ? 'pendência' : 'pendências'} dos bates anteriores`
                  : `${inteiro(ultima.total_titulos)} títulos na amostra, de ${inteiro(ultima.populacao_titulos)} no estoque`}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400"><Contagem contagem={ultima.contagem} /></p>
            </div>
            <Botao variante="fantasma" tamanho="sm" onClick={() => setUltima(null)} aria-label="Fechar resultado"><X className="size-4" /></Botao>
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed border-indigo-300 px-5 py-4 dark:border-indigo-500/40">
            <span className="text-sm text-slate-700 dark:text-slate-300">Seed</span>
            <strong className="font-mono text-xl tracking-widest text-indigo-700 dark:text-indigo-300">{ultima.seed}</strong>
            <span className="min-w-[16rem] flex-1 text-xs text-slate-600 dark:text-slate-400">
              A seed fica registrada aqui e na aba Reproducao do Excel. &quot;Verificar&quot;, no histórico, refaz o sorteio com o estoque guardado e confirma que a amostra é a mesma.
              {ultima.regra === 'planner' && ' As pendências são a foto dos bates no momento da geração.'}
            </span>
          </div>
          {ultima.avisos.length > 0 && (
            <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300">
              {ultima.avisos.map((a) => <li key={a} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{a}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <a className="lastro-botao lastro-botao-md lastro-botao-secundario" href={amostraApi.urlDownload(ultima.id, 'amostra')}><Download className="size-4" /> Baixar amostra</a>
            <a className="lastro-botao lastro-botao-md lastro-botao-secundario" href={amostraApi.urlDownload(ultima.id, 'pacote')}><Package className="size-4" /> Amostra + arquivos (.zip)</a>
            <Botao variante="primario" className="md:ml-auto" onClick={() => usarComoBase(ultima)}><ArrowRight className="size-4" /> Usar como base</Botao>
          </div>
        </section>
      )}

      {fundoId && (
        <section className="lastro-cartao overflow-hidden">
          <div className="border-b border-dashed border-slate-300 px-6 py-4 dark:border-slate-700">
            <h2 className="font-display text-lg tracking-tight">Histórico — {fundoAtual?.nome}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Todas as amostras sorteadas, inclusive as descartadas, com o motivo.</p>
          </div>
          {carregandoHistorico ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="size-5 animate-spin" /> Carregando o histórico…</p>
          ) : !historico.length ? (
            <div className="p-6"><Vazio icone={<IconeRabisco tipo="sparkle" tamanho={40} />} titulo="Nenhuma amostra gerada para este fundo">Gere a primeira acima.</Vazio></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                    {['Período', 'Seed', 'Títulos', 'Situação', 'Gerada em', ''].map((h) => <th key={h} className="lastro-rotulo px-4 py-3 text-slate-500 dark:text-slate-400">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {historico.map((a) => {
                    const v = verificacoes[a.id];
                    return (
                      <Fragment key={a.id}>
                        <tr className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                          <td className="whitespace-nowrap px-4 py-3">{dataBr(a.data_de)} a {dataBr(a.data_ate)}{a.regra === 'planner' && <div className="text-xs text-slate-500">Planner</div>}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono">{a.seed}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{inteiro(a.total_titulos)}<div className="text-xs"><Contagem contagem={a.contagem} /></div></td>
                          <td className="px-4 py-3">
                            {a.status === 'GERADA' ? <Etiqueta cor="emerald"><CheckCircle2 className="size-3" /> valendo</Etiqueta> : (
                              <div><Etiqueta>descartada</Etiqueta><p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">{a.motivo_descarte}</p></div>
                            )}
                            {v && (
                              <p className={cx('mt-1 text-xs', v.identica ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')} title={v.divergencias.join('\n') || undefined}>
                                {v.identica ? 'Refeita: idêntica' : `Refeita: diverge (${v.divergencias.length})`}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{dataBr(a.criado_em)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              <a className="lastro-botao lastro-botao-sm lastro-botao-secundario" href={amostraApi.urlDownload(a.id, 'amostra')} aria-label={`Baixar amostra ${a.seed}`}><Download className="size-3.5" /> Amostra</a>
                              <a className="lastro-botao lastro-botao-sm lastro-botao-secundario" href={amostraApi.urlDownload(a.id, 'pacote')} aria-label={`Baixar amostra com estoque ${a.seed}`}><Package className="size-3.5" /> Com estoque</a>
                              <Botao tamanho="sm" onClick={() => verificar(a)} disabled={!!ocupado}>
                                {ocupado === `${a.id}:verificar` ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Verificar
                              </Botao>
                              {a.status === 'GERADA' && <Botao tamanho="sm" onClick={() => usarComoBase(a)}><ArrowRight className="size-3.5" /> Usar como base</Botao>}
                              {a.status === 'GERADA' && <Botao tamanho="sm" variante="perigo" onClick={() => { setDescartando(a.id); setMotivoDescarte(''); }}>Descartar</Botao>}
                            </div>
                          </td>
                        </tr>
                        {v && !v.identica && (
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            <td colSpan={6} className="px-6 pb-4">
                              <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700 dark:text-rose-300">{v.divergencias.map((d) => <li key={d}>{d}</li>)}</ul>
                            </td>
                          </tr>
                        )}
                        {descartando === a.id && (
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            <td colSpan={6} className="px-6 pb-5 pt-1">
                              <div className="space-y-3 rounded-2xl border-2 border-dashed border-rose-300 p-4 dark:border-rose-500/40">
                                <div>
                                  <p className="text-sm font-semibold">Descartar a amostra <span className="font-mono">{a.seed}</span>?</p>
                                  <p className={DICA}>Ela deixa de valer e continua no histórico como descartada, com o motivo. Não dá para desfazer.</p>
                                </div>
                                <input value={motivoDescarte} onChange={(e) => setMotivoDescarte(e.target.value)} aria-label="Motivo do descarte" placeholder="Motivo do descarte (fica registrado)" className="lastro-campo h-10 w-full px-3 text-sm" />
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Botao onClick={() => setDescartando(null)}>Cancelar</Botao>
                                  <Botao variante="perigo" onClick={() => confirmarDescarte(a)} disabled={!!ocupado}>Confirmar descarte</Botao>
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
        </section>
      )}
    </div>
  );
}
