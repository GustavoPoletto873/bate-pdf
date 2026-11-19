'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileCode2, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Indicador, Secao, Vazio } from '@/components/Pagina';
import { Aviso, Botao, Etiqueta, cx } from '@/components/ui';
import { LinkBotao } from '@/components/bates/comum';
import { IconeRabisco } from '@/components/rabiscos';
import { ErroApi } from '@/lib/cliente';
import { notasApi, type FiltroTela, type ProgressoConsulta, type RespostaNotas } from '@/lib/cliente/notas';

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const inteiro = (n: number) => n.toLocaleString('pt-BR');
const pct = (parte: number, total: number) => (total ? `${((parte / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');

const COR_STATUS = { Ativa: 'emerald', Cancelada: 'rose', Erro: 'amber' } as const;

/**
 * Análise › NF Status (pages/AcompanhamentoNotaFiscal do Bate Lastro): resumo, filtros, tabela
 * paginada, XML de cada nota e exportação. Aqui as notas vêm dos XML lidos no Anexo e da
 * consulta no SERPRO pela chave (quando configurada).
 */
export function TelaNotasFiscais() {
  const [filtro, setFiltro] = useState<FiltroTela>({ status: '', base: '', chave: '' });
  const [aplicado, setAplicado] = useState<FiltroTela>(filtro);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<RespostaNotas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
    const [baseConsulta, setBaseConsulta] = useState('');
  const [progresso, setProgresso] = useState<ProgressoConsulta | null>(null);
  const [erroConsulta, setErroConsulta] = useState<string | null>(null);

  // Cada pedido tem uma chave (filtro + página + versão); "carregando" = a chave ainda não voltou.
  const [versao, setVersao] = useState(0);
  const chave = JSON.stringify([aplicado, pagina, versao]);
  const [chaveCarregada, setChaveCarregada] = useState<string | null>(null);
  const carregando = chaveCarregada !== chave;
  const carregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let ativo = true;
    notasApi.listar(aplicado, pagina)
      .then((r) => { if (ativo) { setDados(r); setErro(null); } })
      .catch((e) => { if (ativo) setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar as notas fiscais.'); })
      .finally(() => { if (ativo) setChaveCarregada(chave); });
    return () => { ativo = false; };
  }, [aplicado, pagina, chave]);

  // Acompanha a consulta no SERPRO até terminar e recarrega a tabela no fim.
  useEffect(() => {
    if (!progresso || progresso.terminou) return;
    const t = setInterval(async () => {
      try {
        const r = await notasApi.progresso(progresso.base_id);
        setProgresso(r.progresso);
        if (r.progresso?.terminou) carregar();
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 1500);
    return () => clearInterval(t);
  }, [progresso, carregar]);

  const consultar = async () => {
    if (!baseConsulta) return;
    setErroConsulta(null);
    try {
      setProgresso((await notasApi.consultar(baseConsulta)).progresso);
    } catch (e) {
      setErroConsulta(e instanceof ErroApi ? e.message : 'Não foi possível iniciar a consulta.');
    }
  };

  const aplicar = (novo: FiltroTela) => { setFiltro(novo); setAplicado(novo); setPagina(1); };
  const r = dados?.resumo;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Total de Notas" valor={r ? inteiro(r.total) : '—'} detalhe="Notas processadas" />
        <Indicador rotulo="Notas Ativas" valor={r ? inteiro(r.ativas) : '—'} cor="verde" detalhe="Em funcionamento" />
        <Indicador rotulo="Notas Canceladas" valor={r ? inteiro(r.canceladas) : '—'} cor="rosa" detalhe={`Fora de operação${r?.erros ? ` · ${r.erros} com erro na consulta` : ''}`} />
        <Indicador rotulo="Taxa de Ativas" valor={r ? pct(r.ativas, r.ativas + r.canceladas) : '—'} cor="indigo" detalhe="Percentual ativo" />
      </div>

      <Secao
        titulo="Consultar no SERPRO"
        descricao="Confere a situação de cada NF-e da base direto na Receita, pela chave (coluna CHAVE_NFE da base), como o Bate Lastro faz no upload."
        acoes={dados && (dados.serpro_configurado ? <Etiqueta cor="emerald"><ShieldCheck className="size-3" /> Credenciais configuradas</Etiqueta> : <Etiqueta cor="rose">Credenciais não configuradas</Etiqueta>)}
      >
        {dados && !dados.serpro_configurado ? (
          <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
            <p className="font-serif">Sem as credenciais, a NF Status mostra só o que os XML lidos no Anexo dizem (o protocolo do XML não mostra cancelamento feito depois). Para consultar, coloque no <code className="font-mono">.env.local</code> os mesmos nomes do .env do Bate Lastro e reinicie o app:</p>
            <pre className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-800 dark:bg-slate-900">{'SERPRO_CONSUMER_KEY=...\nSERPRO_SECRET_KEY=...'}</pre>
            <p className="text-xs text-slate-500">Cada consulta é cobrada pelo SERPRO. As chaves nunca aparecem na tela nem no log.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[260px] flex-1">
              <span className="lastro-rotulo mb-1 block text-slate-500 dark:text-slate-400">Base</span>
              <select className="lastro-campo h-10 w-full px-3 text-sm" value={baseConsulta} onChange={(e) => setBaseConsulta(e.target.value)}>
                <option value="">Escolha a base…</option>
                {dados?.bases.filter((b) => b.chaves > 0).map((b) => (
                  <option key={b.id} value={b.id}>{b.nome} — {b.chaves} chave(s){b.consultadas ? `, ${b.consultadas} já consultada(s)` : ''}</option>
                ))}
              </select>
            </label>
            <Botao variante="primario" disabled={!baseConsulta || Boolean(progresso && !progresso.terminou)} onClick={consultar}>
              {progresso && !progresso.terminou ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Consultar notas da base
            </Botao>
            {dados && !dados.bases.some((b) => b.chaves > 0) && <p className="w-full text-xs text-slate-500">Nenhuma base tem chave de NF-e. Ela vem da coluna CHAVE_NFE no Upload Base.</p>}
          </div>
        )}
        {erroConsulta && <div className="mt-3"><Aviso tipo="erro">{erroConsulta}</Aviso></div>}
        {progresso && (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>{progresso.terminou ? 'Consulta concluída' : 'Consultando…'} {progresso.feitas}/{progresso.total}</span>
              <span>{progresso.ativas} ativa(s) · {progresso.canceladas} cancelada(s){progresso.erros ? ` · ${progresso.erros} erro(s)` : ''}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--lastro-realce)]">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progresso.total ? (progresso.feitas / progresso.total) * 100 : 0}%` }} />
            </div>
            {progresso.erro && <Aviso tipo="erro">{progresso.erro}</Aviso>}
          </div>
        )}
      </Secao>

      <Secao
        titulo="Notas fiscais"
        acoes={
          <div className="flex flex-wrap gap-2">
            <LinkBotao tamanho="sm" href={notasApi.urlExportar(aplicado)} download><Download className="size-4" /> Exportar Todas</LinkBotao>
            <LinkBotao tamanho="sm" href={notasApi.urlExportar({ ...aplicado, status: 'ativa' })} download>Exportar Ativas</LinkBotao>
            <LinkBotao tamanho="sm" href={notasApi.urlExportar({ ...aplicado, status: 'cancelada' })} download>Exportar Canceladas</LinkBotao>
            <Botao tamanho="sm" variante="fantasma" onClick={() => carregar()} title="Atualizar"><RefreshCw className={cx('size-4', carregando && 'animate-spin')} /> Atualizar</Botao>
          </div>
        }
      >
        <form className="mb-4 grid gap-3 md:grid-cols-[180px_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); aplicar(filtro); }}>
          <select className="lastro-campo h-10 px-3 text-sm" value={filtro.status} onChange={(e) => aplicar({ ...filtro, status: e.target.value as FiltroTela['status'] })} aria-label="Status">
            <option value="">Todas as Notas</option>
            <option value="ativa">Apenas Ativas</option>
            <option value="cancelada">Apenas Canceladas</option>
            <option value="erro">Com erro na consulta</option>
          </select>
          <input className="lastro-campo h-10 px-3 text-sm" placeholder="Filtrar por base (nome ou ID)" value={filtro.base} onChange={(e) => setFiltro({ ...filtro, base: e.target.value })} />
          <input className="lastro-campo h-10 px-3 font-mono text-sm" placeholder="Filtrar por Chave NFe" value={filtro.chave} onChange={(e) => setFiltro({ ...filtro, chave: e.target.value })} />
          <Botao type="submit" variante="primario"><Search className="size-4" /> Filtrar</Botao>
        </form>

        {erro ? (
          <Aviso tipo="erro">{erro} <button type="button" className="underline" onClick={() => carregar()}>Tentar novamente</button></Aviso>
        ) : !dados ? (
          <p className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Carregando dados das notas fiscais…</p>
        ) : !dados.dados.length ? (
          <Vazio icone={<IconeRabisco tipo="clipe" tamanho={40} />} titulo={dados.resumo.total || aplicado.status || aplicado.base || aplicado.chave ? 'Nenhuma nota com esse filtro' : 'Nenhuma nota fiscal ainda'}>
            As notas aparecem aqui quando um XML de NF-e é lido no Anexo ou quando você consulta as chaves de uma base no SERPRO.
          </Vazio>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr><th className="px-3 py-2">Chave NFe</th><th className="px-3 py-2">Data Consulta</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Origem</th><th className="px-3 py-2">Base</th><th className="px-3 py-2 text-center">XML</th></tr>
                </thead>
                <tbody>
                  {dados.dados.map((n) => (
                    <tr key={n.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-mono text-xs">{n.chave_nfe}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dataHora(n.consulta_data)}</td>
                      <td className="px-3 py-2"><span title={n.mensagem ?? undefined}><Etiqueta cor={COR_STATUS[n.status_nfe]}>{n.status_nfe}</Etiqueta></span></td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{n.origem === 'serpro' ? 'Consulta SERPRO' : 'XML do Anexo'}</td>
                      <td className="max-w-[260px] truncate px-3 py-2" title={n.base_id}>{n.base_nome ?? n.base_id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-center">
                        {n.tem_xml
                          ? <a href={notasApi.urlXml(n.id)} className="inline-flex items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-300" title="Baixar XML"><FileCode2 className="size-4" /></a>
                          : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>{inteiro(dados.paginacao.total)} nota(s) · página {dados.paginacao.pagina} de {dados.paginacao.paginas}</span>
              <div className="flex gap-2">
                <Botao tamanho="sm" disabled={dados.paginacao.pagina <= 1} onClick={() => setPagina((p) => p - 1)}><ChevronLeft className="size-4" /> Anterior</Botao>
                <Botao tamanho="sm" disabled={dados.paginacao.pagina >= dados.paginacao.paginas} onClick={() => setPagina((p) => p + 1)}>Próxima <ChevronRight className="size-4" /></Botao>
              </div>
            </div>
          </>
        )}
      </Secao>
    </div>
  );
}
