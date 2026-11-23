'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Download, FileArchive, FileWarning, Loader2, Lock, RotateCcw, Unlock } from 'lucide-react';
import { apiBates, type FiltroResultadosTela, type RespostaResultados } from '@/lib/cliente/bates';
import { ErroApi } from '@/lib/cliente';
import type { LinhaResultado } from '@/lib/bates/resultados';
import { camposDoLado, CAMPO_POR_ID, ROTULO_LADO } from '@/lib/campos';
import { Aviso, Botao, cx, Dialogo, Etiqueta, Selo } from '@/components/ui';
import { Indicador, Pagina, Secao, Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { BarraMensagem, DialogoPdf, LinkBotao, valorTela, type Mensagem } from '@/components/bates/comum';

type Aba = 'todos' | 'termo' | 'lastro' | 'resumo';

/** De onde veio o V da linha, para a tela. */
export function origemDaLinha(l: LinhaResultado): { texto: string; cor: 'emerald' | 'amber' | 'sky' | 'violet' | 'slate' } {
  if (l.origem === 'ja_batido') return { texto: 'Bate Lastro', cor: 'slate' };
  if (l.origem === 'pre_bate') return { texto: 'Pré-bate a confirmar', cor: 'amber' };
  if (l.origem === 'vinculo') {
    if (l.origem_vinculo === 'planilha') return { texto: 'Planilha', cor: 'sky' };
    if (l.tipo_match === 'automatico') return { texto: 'Automático', cor: 'violet' };
    return { texto: 'Bater PDF', cor: 'emerald' };
  }
  return { texto: 'Pendente', cor: 'slate' };
}

function DialogoComparacao({ linha, onFechar, onVerPdf }: { linha: LinhaResultado | null; onFechar: () => void; onVerPdf: (p: { id: number; nome: string; pagina: number | null }) => void }) {
  if (!linha) return null;
  const origem = origemDaLinha(linha);
  return (
    <Dialogo aberto titulo={`${ROTULO_LADO[linha.lado]} · Doc ${linha.titulo.numero_documento ?? linha.titulo.id}`} onFechar={onFechar} largura="max-w-3xl">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Selo valor={linha.status} />
          <Etiqueta cor={origem.cor}>{origem.texto}</Etiqueta>
          {linha.similaridade !== null && <span className="text-xs text-slate-500 dark:text-slate-400">similaridade {linha.similaridade.toFixed(1)}</span>}
          {linha.titulo.id_base_origem && <span className="text-xs text-slate-500 dark:text-slate-400">ID_BASE {linha.titulo.id_base_origem}</span>}
          {linha.pdf && (
            <button type="button" className="ml-auto text-xs underline decoration-dotted hover:text-indigo-600 dark:hover:text-indigo-400" onClick={() => onVerPdf(linha.pdf!)}>
              {linha.pdf.nome}{linha.pdf.pagina ? `, pág. ${linha.pdf.pagina}` : ''}
            </button>
          )}
        </div>
        {linha.origem === 'ja_batido' && <Aviso tipo="info">Este lado veio batido do Bate Lastro: a leitura e os vereditos estão lá.</Aviso>}
        {linha.status === 'P' && <Aviso tipo="alerta">Ainda sem documento. Resolva pelo Bater PDF ou processe a base de novo depois de enviar os documentos.</Aviso>}
        <table className="w-full text-xs">
          <thead className="lastro-rotulo text-left text-slate-500 dark:text-slate-400">
            <tr><th className="py-1">Campo</th><th className="py-1">Base</th><th className="py-1">Leitura</th><th className="py-1 text-center">V/D/P</th></tr>
          </thead>
          <tbody>
            {camposDoLado(linha.lado).map((def) => {
              const base = linha.titulo[def.campoBase];
              return (
                <tr key={def.campo} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-2 font-medium text-slate-700 dark:text-slate-200">{def.rotulo}</td>
                  <td className="break-all py-1.5 pr-2">{valorTela(def.campo, base === null || base === undefined ? null : String(base))}</td>
                  <td className="break-all py-1.5 pr-2">{linha.leitura ? valorTela(def.campo, linha.leitura[def.campo]) : '—'}</td>
                  <td className="py-1.5 text-center">{linha.vereditos ? <Selo valor={linha.vereditos[def.campo]} tamanho="sm" /> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialogo>
  );
}

/** Bates › Resultados (ResultsPage do Bate Lastro). */
export function Resultados({ baseId }: { baseId: string }) {
  const [filtro, setFiltro] = useState<FiltroResultadosTela>({ aba: 'todos', status: 'todos', q: '', pagina: 1 });
  const [texto, setTexto] = useState('');
  const [aba, setAba] = useState<Aba>('todos');
  const [versao, setVersao] = useState(0);
  const [resposta, setResposta] = useState<{ chave: string; dados: RespostaResultados } | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [detalhe, setDetalhe] = useState<LinhaResultado | null>(null);
  const [pdf, setPdf] = useState<{ id: number; nome: string; pagina: number | null } | null>(null);
  const [dialogoPendencias, setDialogoPendencias] = useState(false);
  const [dialogoDocumentos, setDialogoDocumentos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const chave = JSON.stringify([filtro, versao]);

  useEffect(() => {
    let vivo = true;
    apiBates.resultados(baseId, filtro)
      .then((dados) => { if (vivo) setResposta({ chave, dados }); })
      .catch((e) => { if (vivo) setErroCarga(e instanceof ErroApi ? e.message : 'Não foi possível carregar os resultados.'); });
    return () => { vivo = false; };
  }, [baseId, filtro, chave]);

  // A busca por texto espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => setFiltro((f) => (f.q === texto ? f : { ...f, q: texto, pagina: 1 })), 350);
    return () => clearTimeout(t);
  }, [texto]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const trocarAba = (nova: Aba) => {
    setAba(nova);
    if (nova !== 'resumo') setFiltro((f) => ({ ...f, aba: nova, pagina: 1 }));
  };

  const alternarFinalizada = async (finalizada: boolean) => {
    setSalvando(true);
    try {
      await apiBates.finalizar(baseId, finalizada);
      setMensagem({ tipo: 'ok', texto: finalizada ? 'Auditoria marcada como finalizada.' : 'Auditoria reaberta para edição.' });
      recarregar();
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível mudar o status da auditoria.' });
    } finally {
      setSalvando(false);
    }
  };

  if (erroCarga) {
    return <Pagina titulo="Resultados" voltar={<Link href={`/pre-matches?base=${baseId}`}>← Gestão de Bates</Link>}><Aviso tipo="erro">{erroCarga}</Aviso></Pagina>;
  }
  if (!resposta) return <p className="flex items-center gap-2 p-8 text-sm text-slate-500 dark:text-slate-400"><Loader2 className="size-4 animate-spin" /> Carregando os resultados…</p>;

  const { base, estatisticas: est, linhas, total, pagina, tamanho } = resposta.dados;
  const carregando = resposta.chave !== chave;
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  const finalizada = Boolean(base.finalizada);

  return (
    <Pagina
      largura="max-w-7xl"
      titulo="Resultados"
      subtitulo={<>Resultado do matching da base, campo a campo. <span className="text-slate-500 dark:text-slate-400">{base.nome}{base.nome_fundo ? ` · ${base.nome_fundo}` : ''}</span></>}
      voltar={<Link href={`/pre-matches?base=${baseId}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">← Gestão de Bates</Link>}
      acoes={
        <>
          <Botao onClick={recarregar}><RotateCcw className="size-4" /> Atualizar</Botao>
          <LinkBotao href={apiBates.urlExportar(baseId)} download variante="primario" title={base.cnpj_fundo ? 'resultados_matching no formato do Bate Lastro (o Inserir Resultado de lá lê este arquivo)' : 'Falta o CNPJ do fundo: sem ele o Inserir Resultado do Bate Lastro recusa o arquivo'}>
            <Download className="size-4" /> Exportar para Excel
          </LinkBotao>
          <Botao onClick={() => setDialogoPendencias(true)} title="Extrair todas as pendências TERMO e LASTRO desta base"><FileWarning className="size-4" /> Exportar pendências</Botao>
          <Botao onClick={() => setDialogoDocumentos(true)} title="ZIP com os documentos usados nos bates e um índice de auditoria"><FileArchive className="size-4" /> Exportar documentos</Botao>
        </>
      }
    >
      <BarraMensagem mensagem={mensagem} onFechar={() => setMensagem(null)} />
      {!base.cnpj_fundo && <div className="mb-4"><Aviso tipo="alerta">A base está sem o CNPJ do fundo: o Inserir Resultado do Bate Lastro recusa a planilha. Informe o CNPJ em Exportar p/ Bate Lastro, no Bater PDF.</Aviso></div>}
      {est.origem_v.pre_bate > 0 && (
        <div className="mb-4">
          <Aviso tipo="alerta">
            {est.origem_v.pre_bate} pré-bate(s) ainda não confirmado(s) contam como V e saem com STATUS V no Excel (como no Bate Lastro): o Inserir Resultado de lá os grava como bates.
            {' '}Confirme ou rejeite na <Link href={`/pre-matches?base=${baseId}`} className="underline">Gestão de Bates</Link> antes de exportar.
          </Aviso>
        </div>
      )}

      <div className="mb-6 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.3fr]">
        <Indicador rotulo="Bates com correspondências" valor={est.geral.total_v} cor="verde" detalhe={`${est.geral.taxa.toFixed(1)}% de ${est.geral.total}`} />
        <Indicador rotulo="Bates com pendências" valor={est.geral.total_p} cor="rosa" detalhe={`Termo ${est.termo.total_p} · Lastro ${est.lastro.total_p}`} />
        <Indicador rotulo="Com divergência" valor={est.divergentes} cor="ambar" detalhe="Pelo menos um campo em D" />
        <div className="lastro-cartao flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="lastro-rotulo text-slate-500 dark:text-slate-400">Status da Auditoria</p>
            <p className={cx('mt-1 flex items-center gap-1 text-sm font-bold', finalizada ? 'text-violet-700 dark:text-violet-400' : 'text-sky-700 dark:text-sky-400')}>
              {finalizada ? <Lock className="size-4" /> : <Unlock className="size-4" />} {finalizada ? 'Finalizada' : 'Em andamento'}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            Marcar como finalizada
            <button
              type="button"
              role="switch"
              aria-checked={finalizada}
              disabled={salvando}
              onClick={() => alternarFinalizada(!finalizada)}
              className={cx('relative h-6 w-11 rounded-full border-[1.5px] border-slate-900 transition-colors disabled:opacity-50 dark:border-slate-200', finalizada ? 'bg-slate-900 dark:bg-slate-200' : 'bg-white dark:bg-slate-900')}
            >
              <span className={cx('absolute top-0.5 size-4 rounded-full transition-all', finalizada ? 'left-5 bg-white dark:bg-slate-900' : 'left-0.5 bg-slate-900 dark:bg-slate-200')} />
            </button>
          </label>
        </div>
      </div>

      <Secao>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-dashed border-slate-300 dark:border-slate-700">
          <div className="flex flex-wrap gap-6">
            {([['todos', 'Todos', est.geral.total], ['termo', 'TERMO', est.termo.total], ['lastro', 'LASTRO', est.lastro.total], ['resumo', 'Resumo', 0]] as const).map(([id, rotulo, n]) => (
              <button key={id} type="button" onClick={() => trocarAba(id)}
                className={cx('-mb-px flex items-center gap-1 border-b-2 pb-2 text-sm font-bold transition-colors',
                  aba === id ? 'border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')}>
                {id === 'resumo' && <BarChart3 className="size-4" />}{rotulo}
                {n > 0 && <span className="ml-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium dark:border-slate-600">{n}</span>}
              </button>
            ))}
          </div>
          {aba !== 'resumo' && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select className="lastro-campo h-8 px-2 text-xs" value={filtro.status} aria-label="Status"
                onChange={(e) => setFiltro((f) => ({ ...f, status: e.target.value as FiltroResultadosTela['status'], pagina: 1 }))}>
                <option value="todos">Todos</option><option value="V">Confirmados</option><option value="P">Pendentes</option>
              </select>
              <input className="lastro-campo h-8 w-64 px-3 text-xs" placeholder="Buscar nº, nome, CPF/CNPJ ou PDF" value={texto} onChange={(e) => setTexto(e.target.value)} />
              {carregando && <Loader2 className="size-4 animate-spin text-slate-400" />}
            </div>
          )}
        </div>

        {aba === 'resumo' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {(['termo', 'lastro'] as const).map((lado) => {
              const c = est[lado];
              return (
                <div key={lado} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <p className="font-display text-lg">{lado === 'termo' ? 'TERMO' : 'LASTRO'}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div><p className="font-display text-2xl text-emerald-700 dark:text-emerald-400">{c.total_v}</p><p className="text-xs text-slate-500 dark:text-slate-400">Confirmados</p></div>
                    <div><p className="font-display text-2xl text-rose-700 dark:text-rose-400">{c.total_p}</p><p className="text-xs text-slate-500 dark:text-slate-400">Pendentes</p></div>
                    <div><p className="font-display text-2xl">{c.taxa.toFixed(1)}%</p><p className="text-xs text-slate-500 dark:text-slate-400">Taxa</p></div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-rose-200 dark:bg-rose-500/30">
                    <div className="h-full bg-emerald-500" style={{ width: `${c.taxa}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800 md:col-span-2">
              <p className="lastro-rotulo mb-2 text-slate-500 dark:text-slate-400">De onde vêm os confirmados</p>
              <div className="flex flex-wrap gap-2">
                <Etiqueta cor="emerald">Bater PDF / manual: {est.origem_v.manual}</Etiqueta>
                <Etiqueta cor="violet">Automático (pré-bate confirmado): {est.origem_v.automatico}</Etiqueta>
                <Etiqueta cor="amber">Pré-bate a confirmar: {est.origem_v.pre_bate}</Etiqueta>
                <Etiqueta cor="slate">Já batido no Bate Lastro: {est.origem_v.ja_batido}</Etiqueta>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{est.total_registros} título(s) na base · {est.geral.total} conferência(s) título × lado.</p>
            </div>
          </div>
        ) : !linhas.length ? (
          <Vazio icone={<IconeRabisco tipo="lupa" tamanho={40} />} titulo="Nada com esse filtro">Mude o status ou a busca.</Vazio>
        ) : (
          <div className={cx('rolagem-fina overflow-x-auto rounded-xl border-[1.5px] border-slate-900 dark:border-slate-600', carregando && 'opacity-60')}>
            <table className="w-full min-w-[960px] text-sm">
              <thead className="lastro-rotulo bg-slate-50 text-left text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="px-3 py-2">Tipo</th><th className="px-2 py-2">Nº Doc</th><th className="px-2 py-2">Sacado</th>
                  <th className="px-2 py-2">Valor</th><th className="px-2 py-2">Vencimento</th><th className="px-2 py-2 text-center">Status</th>
                  <th className="px-2 py-2">Origem</th><th className="px-2 py-2">Campos (V/D/P)</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const origem = origemDaLinha(l);
                  return (
                    <tr key={l.pendencia_id} onClick={() => setDetalhe(l)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60">
                      <td className="px-3 py-2"><Etiqueta cor={l.lado === 'termo' ? 'violet' : 'sky'}>{l.lado === 'termo' ? 'TERMO' : 'LASTRO'}</Etiqueta></td>
                      <td className="px-2 py-2 font-mono font-bold">{l.titulo.numero_documento ?? '—'}</td>
                      <td className="max-w-[220px] truncate px-2 py-2" title={l.titulo.sacado_nome ?? ''}>{l.titulo.sacado_nome ?? '—'}</td>
                      <td className="px-2 py-2 tabular-nums">{valorTela('valor_total', l.titulo.valor_total)}</td>
                      <td className="px-2 py-2 tabular-nums">{valorTela('data_vencimento', l.titulo.data_vencimento)}</td>
                      <td className="px-2 py-2 text-center"><Selo valor={l.status} /></td>
                      <td className="px-2 py-2"><Etiqueta cor={origem.cor}>{origem.texto}</Etiqueta></td>
                      <td className="px-2 py-2">
                        {l.vereditos ? (
                          <div className="flex flex-wrap gap-0.5">
                            {camposDoLado(l.lado).map((def) => <Selo key={def.campo} valor={l.vereditos![def.campo]} tamanho="sm" titulo={`${CAMPO_POR_ID[def.campo].rotulo}: ${l.vereditos![def.campo]}`} />)}
                          </div>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {aba !== 'resumo' && paginas > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{total} linha(s) · página {pagina} de {paginas}</span>
            <div className="flex gap-2">
              <Botao tamanho="sm" variante="fantasma" disabled={pagina <= 1 || carregando} onClick={() => setFiltro((f) => ({ ...f, pagina: pagina - 1 }))}>← Anterior</Botao>
              <Botao tamanho="sm" variante="fantasma" disabled={pagina >= paginas || carregando} onClick={() => setFiltro((f) => ({ ...f, pagina: pagina + 1 }))}>Próxima →</Botao>
            </div>
          </div>
        )}
      </Secao>

      <DialogoComparacao linha={detalhe} onFechar={() => setDetalhe(null)} onVerPdf={(p) => { setDetalhe(null); setPdf(p); }} />
      <DialogoPdf pdf={pdf} onFechar={() => setPdf(null)} />
      <Dialogo aberto={dialogoDocumentos} titulo="Exportar documentos" onFechar={() => setDialogoDocumentos(false)} largura="max-w-lg">
        <div className="space-y-3 text-sm">
          <p className="font-serif text-slate-600 dark:text-slate-400">Um ZIP para o dossiê da auditoria: os documentos (com as pastas das operações do Anexo), os XML das NF-e, o índice 00_INDICE_AUDITORIA.xlsx (arquivos e vínculos título × documento) e o SHA256SUMS.txt para conferir a integridade.</p>
          <div className="grid gap-2">
            <LinkBotao href={apiBates.urlDocumentos(baseId, 'vinculados')} download variante="primario"><Download className="size-4" /> Só os documentos com bate</LinkBotao>
            <LinkBotao href={apiBates.urlDocumentos(baseId, 'todos')} download><Download className="size-4" /> Todos os documentos da base</LinkBotao>
          </div>
        </div>
      </Dialogo>
      <Dialogo aberto={dialogoPendencias} titulo="Exportar pendências" onFechar={() => setDialogoPendencias(false)} largura="max-w-lg">
        <div className="space-y-3 text-sm">
          <p className="font-serif text-slate-600 dark:text-slate-400">Os títulos ainda sem documento (pré-bate conta como atendido). Escolha o layout:</p>
          <div className="grid gap-2">
            <LinkBotao href={apiBates.urlPendencias(baseId, 1)} download><Download className="size-4" /> Layout 1 — um item por documento faltante (Lastro e Termo)</LinkBotao>
            <LinkBotao href={apiBates.urlPendencias(baseId, 2)} download><Download className="size-4" /> Layout 2 — consolidado, um título por linha</LinkBotao>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Só o download: esta versão local não envia e-mail.</p>
        </div>
      </Dialogo>
    </Pagina>
  );
}
