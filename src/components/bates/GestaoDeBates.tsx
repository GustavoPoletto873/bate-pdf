'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, FileUp, Link2, Loader2, Play, RotateCcw } from 'lucide-react';
import { apiBates } from '@/lib/cliente/bates';
import { ErroApi } from '@/lib/cliente';
import type { BaseResumo } from '@/lib/repo';
import type { PaginaPreBates, PainelBates, PreBate } from '@/lib/bates/preMatches';
import { Aviso, Botao, cx } from '@/components/ui';
import { Indicador, Pagina, Secao } from '@/components/Pagina';
import { BarraMensagem, DialogoPdf, LinkBotao, type Mensagem } from '@/components/bates/comum';
import { TabelaPreBates } from '@/components/bates/TabelaPreBates';
import { PainelPendencias } from '@/components/bates/PainelPendencias';
import { DialogoInserirResultado } from '@/components/bates/DialogoInserirResultado';

type Aba = 'todos' | 'termo' | 'lastro';

const DICA_BLOQUEIO = 'Todos os documentos lidos desta base já estão pareados. Envie novos documentos antes de processar novamente.';

/** Bates › Gestão de Bates (PreMatchesPage do Bate Lastro). */
export function GestaoDeBates({ baseId }: { baseId: string }) {
  const [cabecalho, setCabecalho] = useState<{ base: BaseResumo; painel: PainelBates } | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = useState<Aba>('todos');
  const [niveis, setNiveis] = useState<number[]>([]);
  const [pagina, setPagina] = useState(1);
  const [lista, setLista] = useState<{ chave: string; dados: PaginaPreBates } | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [processando, setProcessando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [inserirAberto, setInserirAberto] = useState(false);
  const [pdf, setPdf] = useState<{ id: number; nome: string } | null>(null);
  const chave = `${aba}|${niveis.join(',')}|${pagina}|${versao}`;

  const avisar = useCallback((tipo: NonNullable<Mensagem>['tipo'], texto: string) => setMensagem({ tipo, texto }), []);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    apiBates.painel(baseId)
      .then((r) => { if (vivo) setCabecalho(r); })
      .catch((e) => { if (vivo) setErroCarga(e instanceof ErroApi ? e.message : 'Não foi possível abrir a base.'); });
    return () => { vivo = false; };
  }, [baseId, versao]);

  useEffect(() => {
    let vivo = true;
    const [tipo, conf, pag] = chave.split('|');
    apiBates.preBates(baseId, { tipo: tipo as Aba, confiabilidade: conf ? conf.split(',').map(Number) : [], pagina: Number(pag) })
      .then((dados) => { if (vivo) setLista({ chave, dados }); })
      .catch((e) => { if (vivo) setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível carregar os pré-bates.' }); });
    return () => { vivo = false; };
  }, [baseId, chave]);

  const trocarAba = (nova: Aba) => { setAba(nova); setPagina(1); setNiveis([]); setSelecionados(new Set()); };
  const trocarNiveis = (n: number[]) => { setNiveis(n); setPagina(1); setSelecionados(new Set()); };

  const processar = async () => {
    setProcessando(true);
    try {
      const r = await apiBates.processar(baseId);
      if (r.aviso) avisar('alerta', r.aviso);
      else {
        const q = r.quantidade_pre_matches;
        avisar('ok', `Processamento concluído em ${r.tempo_processamento}: ${q.total} pré-bate(s) novo(s) (Termo ${q.termo}, Lastro ${q.lastro}). `
          + `${r.quantidade_pendencias.total} pendência(s) continuam sem documento.`);
      }
      setPagina(1);
      recarregar();
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'O processamento falhou. Tente de novo.');
    } finally {
      setProcessando(false);
    }
  };

  const confirmar = async (ids: number[]) => {
    if (ids.length > 1 && !window.confirm(`Confirmar ${ids.length} pré-bate(s)?`)) return;
    setOcupado(true);
    try {
      const r = await apiBates.confirmar(baseId, ids);
      avisar('ok', `${r.confirmados} bate(s) confirmado(s).${r.descartados ? ` ${r.descartados} pré-bate(s) de títulos já batidos foram descartados.` : ''}`);
      setSelecionados((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
      recarregar();
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível confirmar. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const rejeitar = async (ids: number[]) => {
    if (!window.confirm(`Rejeitar ${ids.length} pré-bate(s)? O título volta para as pendências e a leitura fica sem título.`)) return;
    setOcupado(true);
    try {
      const r = await apiBates.rejeitar(baseId, ids);
      avisar('ok', `${r.rejeitados} pré-bate(s) rejeitado(s).`);
      setSelecionados((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
      recarregar();
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível rejeitar. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  if (erroCarga) {
    return (
      <Pagina titulo="Gestão de Bates" voltar={<Link href="/auditoria-selection">← Voltar à Seleção de Auditoria</Link>}>
        <Aviso tipo="erro">{erroCarga}</Aviso>
      </Pagina>
    );
  }
  if (!cabecalho) {
    return <p className="flex items-center gap-2 p-8 text-sm text-slate-500 dark:text-slate-400"><Loader2 className="size-4 animate-spin" /> Carregando a base…</p>;
  }

  const { base, painel } = cabecalho;
  const dados = lista?.dados ?? null;
  const carregandoLista = lista?.chave !== chave;
  const abas: { id: Aba; rotulo: string; n: number }[] = [
    { id: 'todos', rotulo: 'Todos', n: dados?.por_tipo.todos ?? 0 },
    { id: 'termo', rotulo: 'Termos', n: dados?.por_tipo.termo ?? 0 },
    { id: 'lastro', rotulo: 'Lastros', n: dados?.por_tipo.lastro ?? 0 },
  ];

  return (
    <Pagina
      largura="max-w-7xl"
      titulo="Gestão de Bates"
      subtitulo={<>Processe a base, confirme os pré-bates e resolva as pendências. <span className="text-slate-500 dark:text-slate-400">{base.nome}{base.nome_fundo ? ` · ${base.nome_fundo}` : ''}</span></>}
      voltar={<Link href="/auditoria-selection" className="hover:text-indigo-600 dark:hover:text-indigo-400">← Voltar à Seleção de Auditoria</Link>}
      acoes={
        <>
          <span className="flex flex-col items-end">
            <Botao variante="primario" onClick={processar} disabled={processando || !painel.pode_processar} title={painel.pode_processar ? 'Cruza as leituras ainda sem par com os títulos pendentes (a cascata do Bate Lastro)' : DICA_BLOQUEIO}>
              {processando ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {processando ? 'Processando…' : 'Processar Base'}
            </Botao>
            {!processando && !painel.pode_processar && <span className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Sem documentos novos para processar</span>}
          </span>
          <Botao onClick={recarregar}><RotateCcw className="size-4" /> Atualizar</Botao>
          <Botao onClick={() => setInserirAberto(true)} disabled={processando}><FileUp className="size-4" /> Inserir Resultado</Botao>
          <LinkBotao href={`/bases/${baseId}`}><Link2 className="size-4" /> Bater PDF</LinkBotao>
          <LinkBotao href={`/results?base=${baseId}`}><BarChart3 className="size-4" /> Resultados</LinkBotao>
        </>
      }
    >
      <BarraMensagem mensagem={mensagem} onFechar={() => setMensagem(null)} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Indicador rotulo="Bates Confirmados" valor={painel.total_confirmados} cor="verde"
          detalhe={`Automático: ${painel.confirmados.automaticos} | Manual: ${painel.confirmados.manuais}${painel.confirmados.do_bate_lastro ? ` | Do Bate Lastro: ${painel.confirmados.do_bate_lastro}` : ''}`} />
        <Indicador rotulo="Bates Pendentes" valor={painel.pendentes.termo + painel.pendentes.lastro} cor="rosa" detalhe={`Termos: ${painel.pendentes.termo} | Lastros: ${painel.pendentes.lastro}`} />
        <Indicador rotulo="Pré-Bates a Confirmar" valor={painel.total_pre_matches} cor="ambar" detalhe={`Termos: ${painel.pre_matches.termo} | Lastros: ${painel.pre_matches.lastro}`} />
        <Indicador rotulo="Total Registros na Base" valor={painel.total_registros} detalhe="Quantidade de itens na base" />
        <Indicador rotulo="Leitura Termos" valor={painel.leituras.termo} cor="indigo" detalhe={`Documentos lidos · ${painel.leituras.linhas_termo} linha(s)`} />
        <Indicador rotulo="Leitura Lastros" valor={painel.leituras.lastro} cor="indigo" detalhe={`Documentos lidos · ${painel.leituras.linhas_lastro} linha(s)${painel.leituras.orfas ? ` · ${painel.leituras.orfas} sem título` : ''}`} />
      </div>

      <Secao className="mb-6">
        <div className="mb-4 flex flex-wrap gap-6 border-b border-dashed border-slate-300 dark:border-slate-700">
          {abas.map((t) => (
            <button key={t.id} type="button" onClick={() => trocarAba(t.id)}
              className={cx('-mb-px border-b-2 pb-2 text-sm font-bold transition-colors',
                aba === t.id ? 'border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')}>
              {t.rotulo}
              {t.n > 0 && <span className="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium dark:border-slate-600">{t.n}</span>}
            </button>
          ))}
        </div>
        <TabelaPreBates
          dados={dados}
          carregando={carregandoLista}
          aba={aba}
          niveis={niveis}
          selecionados={selecionados}
          ocupado={ocupado}
          onNiveis={trocarNiveis}
          onPagina={setPagina}
          onMarcar={(ids, marcar) => setSelecionados((s) => { const n = new Set(s); ids.forEach((i) => (marcar ? n.add(i) : n.delete(i))); return n; })}
          onSelecionarTodos={() => dados && setSelecionados(new Set(dados.ids))}
          onLimpar={() => setSelecionados(new Set())}
          onConfirmar={confirmar}
          onRejeitar={rejeitar}
          onVerPdf={(item: PreBate) => item.leitura.pdf_id && setPdf({ id: item.leitura.pdf_id, nome: item.leitura.pdf_nome ?? `PDF ${item.leitura.pdf_id}` })}
        />
      </Secao>

      <PainelPendencias baseId={baseId} versao={versao} onVerPdf={setPdf} />

      <DialogoInserirResultado
        baseId={baseId}
        aberto={inserirAberto}
        onFechar={() => setInserirAberto(false)}
        onInserido={(r) => {
          avisar('ok', r.total_a_gravar ? `${r.total_a_gravar} título(s) atualizados com o resultado da planilha.` : 'Nada a alterar: a base já está igual à planilha.');
          recarregar();
        }}
      />
      <DialogoPdf pdf={pdf} onFechar={() => setPdf(null)} />
    </Pagina>
  );
}
