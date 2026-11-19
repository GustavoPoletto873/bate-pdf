'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Paperclip, Table2, X } from 'lucide-react';
import type { Fundo } from '@/lib/fundos';
import type { AnaliseArquivo } from '@/lib/upload-base/colunas';
import type { BaseRegistrada } from '@/lib/upload-base/registrar';
import { descreverErro, type ErroValidacao } from '@/lib/upload-base/erros';
import { dataBr, dataIsoValida, fimDoTrimestre, type ModoReferencia } from '@/lib/upload-base/datas';
import { apiFundos } from '@/lib/cliente/fundos';
import { apiUploadBase } from '@/lib/cliente/uploadBase';
import { ErroApi } from '@/lib/cliente';
import { Secao } from '@/components/Pagina';
import { Aviso, Botao, cx } from '@/components/ui';
import { IconeRabisco } from '@/components/rabiscos';
import { mensagemDeErro } from '@/components/fundos/util';
import { EtapaMapeamento } from './EtapaMapeamento';
import { ImportarResultados } from './ImportarResultados';
import { AlertaBlackListBase, AvisoUploadRecente, CampoReferencia, Etapas, EscolhaFundo, type Referencia } from './partes';

type Origem = 'planilha' | 'resultados';
type Recentes = Awaited<ReturnType<typeof apiUploadBase.recentes>>;

const anoAtual = () => String(new Date().getFullYear());
const referenciaVazia = (): Referencia => ({ porTrimestre: false, data: '', trimestre: '', ano: anoAtual() });

function tamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Gestão › Upload Base (UploadBase.jsx): Dados → Mapeamento → Concluído. */
export function UploadBase({ amostraId }: { amostraId?: string | null }) {
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [origem, setOrigem] = useState<Origem>('planilha');
  const [fundos, setFundos] = useState<Fundo[] | null>(null);
  const [erroFundos, setErroFundos] = useState<string | null>(null);
  const [fundoId, setFundoId] = useState('');
  const [ref, setRef] = useState<Referencia>(referenciaVazia);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [analise, setAnalise] = useState<AnaliseArquivo | null>(null);
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<'analisando' | 'processando' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<ErroValidacao[]>([]);
  const [recentes, setRecentes] = useState<Recentes | null>(null);
  const [concluida, setConcluida] = useState<BaseRegistrada | null>(null);
  const [blacklistAberta, setBlacklistAberta] = useState(false);
  const [amostra, setAmostra] = useState<{ estado: 'carregando' | 'ok' | 'erro'; texto?: string; seed?: string; de?: string; ate?: string } | null>(
    amostraId ? { estado: 'carregando' } : null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    apiFundos.todos()
      .then((f) => { if (vivo) setFundos(f); })
      .catch(() => { if (vivo) { setFundos([]); setErroFundos('Não foi possível carregar a lista de fundos. Atualize a página.'); } });
    return () => { vivo = false; };
  }, []);

  // "Usar como base" da tela Amostra: fundo, data (fim do período sorteado) e arquivo já preenchidos.
  useEffect(() => {
    if (!amostraId) return;
    let vivo = true;
    (async () => {
      try {
        const resposta = await apiUploadBase.amostra(amostraId) as unknown as Record<string, unknown>;
        const a = (resposta.amostragem ?? resposta.amostra ?? resposta) as Record<string, unknown>;
        const arq = await apiUploadBase.arquivoDaAmostra(amostraId);
        if (!vivo) return;
        const fundo = a.fundo_id ?? a.fund_id;
        if (fundo !== undefined && fundo !== null) setFundoId(String(fundo));
        const ate = String(a.data_ate ?? '').slice(0, 10);
        if (dataIsoValida(ate)) setRef({ ...referenciaVazia(), data: ate });
        setArquivo(arq);
        setAmostra({ estado: 'ok', seed: a.seed ? String(a.seed) : undefined, de: a.data_de ? String(a.data_de) : undefined, ate });
      } catch (e) {
        if (!vivo) return;
        const naoAchou = (e instanceof ErroApi && e.status === 404) || (e instanceof Error && e.message === '404');
        setAmostra({
          estado: 'erro',
          texto: naoAchou
            ? 'Não encontrei essa amostra (ela pode ter sido descartada). Escolha o fundo, a data e o arquivo aqui mesmo.'
            : 'Não foi possível trazer a amostra para cá. Baixe a planilha em Gestão › Amostra e escolha o arquivo aqui.',
        });
      }
    })();
    return () => { vivo = false; };
  }, [amostraId]);

  const fundo = fundos?.find((f) => String(f.id) === fundoId) ?? null;
  const modo: ModoReferencia = ref.porTrimestre ? 'TRIMESTRE' : 'DATA_REFERENCIA';
  const dataReferencia = ref.porTrimestre
    ? (ref.trimestre && Number(ref.ano) >= 1900 ? fimDoTrimestre(Number(ref.trimestre), Number(ref.ano)) : '')
    : ref.data;
  const prontoParaAnalisar = !!fundo && dataIsoValida(dataReferencia) && !!arquivo && !ocupado;
  const fundoDaAmostraFora = amostra?.estado === 'ok' && fundos !== null && !!fundoId && !fundo;

  function escolherArquivo(f: File | undefined) {
    if (!f) return;
    setErro(null);
    setDetalhes([]);
    if (/\.xls$/i.test(f.name)) { setErro('Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx (Arquivo › Salvar como › Pasta de Trabalho do Excel).'); return; }
    if (!/\.(xlsx|csv)$/i.test(f.name)) { setErro(`Tipo de arquivo não aceito (${f.name}). Envie .xlsx ou .csv.`); return; }
    setArquivo(f);
  }

  async function analisar() {
    if (!arquivo) return;
    setRecentes(null);
    setOcupado('analisando');
    setErro(null);
    setDetalhes([]);
    try {
      const a = await apiUploadBase.analisar(arquivo);
      setAnalise(a);
      setMapeamento(Object.fromEntries(a.colunas_arquivo.map((c) => [c, a.sugestoes_mapeamento[c] ?? ''])));
      setEtapa(2);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível analisar o arquivo. Confira se é um .xlsx ou .csv com o cabeçalho na primeira linha.'));
    } finally {
      setOcupado(null);
    }
  }

  async function pedirAnalise() {
    if (!fundo || !arquivo) return;
    try {
      const r = await apiUploadBase.recentes(fundo.id, dataReferencia, modo);
      if (r.tem_uploads_recentes) { setRecentes(r); return; }
    } catch {
      // A verificação não bloqueia: sem ela, segue normalmente (como no Bate Lastro).
    }
    await analisar();
  }

  async function processar() {
    if (!fundo || !arquivo) return;
    setOcupado('processando');
    setErro(null);
    setDetalhes([]);
    try {
      const base = await apiUploadBase.processar(arquivo, { fundo_id: fundo.id, data_referencia: dataReferencia, modo, mapeamento });
      setConcluida(base);
      setBlacklistAberta(base.blacklist.length > 0);
      setEtapa(3);
    } catch (e) {
      const dados = e instanceof ErroApi ? (e.dados as { detalhes?: ErroValidacao[] } | undefined) : undefined;
      setErro(mensagemDeErro(e, 'Não foi possível processar o arquivo. Tente de novo.'));
      setDetalhes(Array.isArray(dados?.detalhes) ? dados.detalhes : []);
    } finally {
      setOcupado(null);
    }
  }

  function concluirResultados(base: BaseRegistrada) {
    setConcluida(base);
    setBlacklistAberta(base.blacklist.length > 0);
    setEtapa(3);
  }

  function recomecar() {
    setEtapa(1);
    setArquivo(null);
    setAnalise(null);
    setMapeamento({});
    setErro(null);
    setDetalhes([]);
    setConcluida(null);
    setFundoId('');
    setRef(referenciaVazia());
    setAmostra(null);
  }

  return (
    <div>
      <Etapas atual={etapa} />
      <AvisoUploadRecente
        info={recentes} fundo={fundo?.nome ?? ''} data={dataReferencia} modo={modo}
        onCancelar={() => setRecentes(null)} onContinuar={analisar}
      />
      <AlertaBlackListBase alertas={blacklistAberta && concluida ? concluida.blacklist : []} onFechar={() => setBlacklistAberta(false)} />

      {etapa === 1 && (
        <div className="space-y-6">
          <div role="radiogroup" aria-label="De onde vem a base" className="inline-flex flex-wrap gap-1 rounded-full border-2 border-slate-900 p-1 dark:border-slate-200">
            {([['planilha', 'Planilha da base (amostra do fundo)'], ['resultados', 'Resultados do Bate Lastro (contingência)']] as const).map(([v, r]) => (
              <button key={v} type="button" role="radio" aria-checked={origem === v} onClick={() => setOrigem(v)}
                className={cx('rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
                  origem === v ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
                {r}
              </button>
            ))}
          </div>

          {erroFundos && <Aviso tipo="erro">{erroFundos}</Aviso>}

          {origem === 'resultados' ? (
            <Secao titulo="Planilha de resultados do Bate Lastro" descricao="resultados_matching_<CNPJ>_*.xlsx, exportado em Resultados.">
              <ImportarResultados fundos={fundos} carregandoFundos={fundos === null} onConcluido={concluirResultados} />
            </Secao>
          ) : (
            <>
              {amostra?.estado === 'carregando' && <Aviso tipo="info">Trazendo a amostra sorteada em Gestão › Amostra…</Aviso>}
              {amostra?.estado === 'erro' && <Aviso tipo="alerta">{amostra.texto}</Aviso>}
              {amostra?.estado === 'ok' && (
                <Aviso tipo="info">
                  <b>Amostra sorteada em Gestão › Amostra</b>
                  {amostra.seed && <> · seed <span className="font-mono">{amostra.seed}</span></>}
                  {amostra.de && amostra.ate && <> · {dataBr(amostra.de)} a {dataBr(amostra.ate)}</>}
                  . O fundo, o arquivo e a data de referência já vieram preenchidos: confira e siga com a análise.
                </Aviso>
              )}
              {fundoDaAmostraFora && <Aviso tipo="alerta">O fundo desta amostra não está mais cadastrado. Escolha o fundo na lista.</Aviso>}

              <Secao titulo="Dados do fundo">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="text-sm">
                    <label htmlFor="upload-fundo" className="lastro-rotulo">Fundo</label>
                    <EscolhaFundo fundos={fundos} carregando={fundos === null} valor={fundo ? fundoId : ''} onChange={setFundoId} />
                  </div>
                  <CampoReferencia valor={ref} onChange={setRef} />
                </div>
              </Secao>

              <div
                role="button" tabIndex={0}
                onClick={() => !ocupado && inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastando(false); }}
                onDrop={(e) => { e.preventDefault(); setArrastando(false); escolherArquivo(e.dataTransfer.files[0]); }}
                className={cx('cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                  arrastando ? 'border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-900' : 'border-slate-300 hover:border-slate-500 dark:border-slate-700 dark:hover:border-slate-500')}
              >
                <IconeRabisco tipo="pdf" tamanho={40} className="mx-auto -rotate-6 text-slate-900 dark:text-slate-200" />
                <p className="mt-3 font-display text-lg">{arrastando ? 'Solte o arquivo aqui!' : 'Arraste o arquivo aqui'}</p>
                <p className="font-serif text-sm text-slate-600 dark:text-slate-400">ou clique para escolher · Excel (.xlsx) ou CSV · um arquivo por vez</p>
                <input ref={inputRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { escolherArquivo(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
              </div>

              {arquivo && (
                <div className="lastro-cartao flex items-center gap-3 px-4 py-3">
                  <FileSpreadsheet className="size-6 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{arquivo.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{tamanho(arquivo.size)}</p>
                  </div>
                  <Botao variante="fantasma" tamanho="sm" onClick={() => setArquivo(null)} disabled={!!ocupado} aria-label="Remover arquivo"><X className="size-4" /></Botao>
                </div>
              )}

              {erro && <Aviso tipo="erro">{erro}</Aviso>}

              <div className="flex flex-wrap items-center gap-3">
                <Botao variante="primario" onClick={pedirAnalise} disabled={!prontoParaAnalisar}>
                  <Table2 className="size-4" /> {ocupado === 'analisando' ? 'Analisando…' : 'Analisar Arquivo'}
                </Botao>
                {!prontoParaAnalisar && !ocupado && (
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {!fundo ? 'Escolha o fundo.' : !dataIsoValida(dataReferencia) ? 'Preencha a data de referência.' : !arquivo ? 'Escolha o arquivo.' : ''}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {etapa === 2 && analise && (
        <Secao>
          <EtapaMapeamento
            analise={analise} arquivo={arquivo?.name ?? ''} mapeamento={mapeamento} onChange={setMapeamento}
            onVoltar={() => { setEtapa(1); setErro(null); setDetalhes([]); }} onProcessar={processar} processando={ocupado === 'processando'}
          />
          {erro && (
            <div className="mt-4 space-y-2">
              <Aviso tipo="erro">{erro}</Aviso>
              {detalhes.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Ver as linhas com problema ({detalhes.length} {detalhes.length === 1 ? 'erro' : 'erros'})</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">{detalhes.map((d) => <li key={`${d.tipo}-${d.campo}`}>{descreverErro(d)}</li>)}</ul>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Corrija na planilha e envie de novo, ou mapeie a coluna certa para o campo. A linha 1 é o cabeçalho.</p>
                </details>
              )}
            </div>
          )}
        </Secao>
      )}

      {etapa === 3 && concluida && (
        <Secao className="text-center">
          <CheckCircle2 className="mx-auto size-14 text-emerald-600 dark:text-emerald-400" />
          <h2 className="mt-3 font-display text-2xl tracking-tight">Base registrada!</h2>
          <p className="mt-1 font-serif text-slate-600 dark:text-slate-400">{concluida.nome}</p>
          <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-3">
            <div className="rounded-xl border-2 border-slate-900 px-3 py-3 dark:border-slate-200"><p className="font-display text-3xl tabular-nums">{concluida.total_registros}</p><p className="lastro-rotulo">títulos</p></div>
            <div className="rounded-xl border-2 border-slate-900 px-3 py-3 dark:border-slate-200"><p className="font-display text-3xl tabular-nums">{concluida.pendentes.termo}</p><p className="lastro-rotulo">pendentes Termo</p></div>
            <div className="rounded-xl border-2 border-slate-900 px-3 py-3 dark:border-slate-200"><p className="font-display text-3xl tabular-nums">{concluida.pendentes.lastro}</p><p className="lastro-rotulo">pendentes Lastro</p></div>
          </div>
          <div className="mx-auto mt-4 max-w-2xl space-y-2 text-left">
            {concluida.ja_batidos > 0 && <Aviso tipo="ok">{concluida.ja_batidos} lados já vieram batidos do Bate Lastro.</Aviso>}
            {concluida.vencimento && concluida.vencimento.completados > 0 && (
              <Aviso tipo="info">
                Em {concluida.vencimento.completados} {concluida.vencimento.completados === 1 ? 'linha' : 'linhas'} o vencimento estava vazio em “{concluida.vencimento.coluna}” e veio de{' '}
                {Object.keys(concluida.vencimento.por_coluna).map((c) => `“${c}”`).join(', ')}.
              </Aviso>
            )}
            {concluida.avisos.map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}
            {concluida.blacklist.length > 0 && (
              <Aviso tipo="alerta">
                {concluida.blacklist.length} {concluida.blacklist.length === 1 ? 'cedente/sacado monitorado' : 'cedentes/sacados monitorados'} na BlackList.{' '}
                <button type="button" className="font-semibold underline" onClick={() => setBlacklistAberta(true)}>Ver quais</button>
              </Aviso>
            )}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/anexo?base=${encodeURIComponent(concluida.base_id)}`} className="lastro-btn lastro-btn-contorno"><Paperclip className="size-4" /> Anexar documentos</Link>
            <Link href={`/pre-matches?base=${encodeURIComponent(concluida.base_id)}`} className="lastro-btn lastro-btn-solido"><IconeRabisco tipo="v" /> Ir para os Bates</Link>
          </div>
          <Botao variante="fantasma" className="mt-4" onClick={recomecar}>Registrar outra base</Botao>
        </Secao>
      )}
    </div>
  );
}
