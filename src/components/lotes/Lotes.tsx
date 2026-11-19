'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Activity, Clock, Database, RefreshCw, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { ErroApi } from '@/lib/cliente';
import { apiLotes, type Acompanhamento, type BaseEmAcompanhamento } from '@/lib/cliente/lotes';
import { formatarData } from '@/lib/valores';
import { Aviso, Botao, Etiqueta } from '@/components/ui';
import { Indicador, Pagina, Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { plural, rotuloTipo } from '@/components/anexo/rotulos';

const ATUALIZAR_MS = 30_000;
const RECENTES = 5;

function referencia(b: BaseEmAcompanhamento): string | null {
  if (!b.data_referencia) return null;
  if (b.modo_referencia === 'TRIMESTRE') {
    const [ano, mes] = b.data_referencia.split('-').map(Number);
    return `${Math.ceil(mes / 3)}º trimestre de ${ano}`;
  }
  return formatarData(b.data_referencia);
}

function CartaoBase({ base, onTentar, ocupado }: { base: BaseEmAcompanhamento; onTentar: (c: { documento_ids?: number[]; base_id?: string }) => void; ocupado: boolean }) {
  const ref = referencia(base);
  return (
    <div className="lastro-cartao p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg">{base.nome_fundo || 'Fundo não identificado'}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">{base.nome}{ref ? ` · Ref: ${ref}` : ''}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={base.base_id}>{base.base_id}</p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-xl border-2 border-amber-300 px-3 py-1.5 text-center dark:border-amber-500/40">
            <p className="lastro-rotulo text-amber-700 dark:text-amber-400">Pendente</p>
            <p className="font-display text-2xl tabular-nums text-amber-700 dark:text-amber-400">{base.totais.pending}</p>
          </div>
          <div className="rounded-xl border-2 border-sky-300 px-3 py-1.5 text-center dark:border-sky-500/40">
            <p className="lastro-rotulo text-sky-700 dark:text-sky-400">Processando</p>
            <p className="font-display text-2xl tabular-nums text-sky-700 dark:text-sky-400">{base.totais.processing}</p>
          </div>
        </div>
      </div>
      {base.totais.total > 0 && (
        <div className="mt-3">
          <div className="flex h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
            <div className="bg-sky-500" style={{ width: `${base.percentuais.processing}%` }} />
            <div className="bg-amber-400" style={{ width: `${base.percentuais.pending}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{base.percentuais.processing}% em andamento · {base.percentuais.pending}% pendente · {plural(base.totais.total, 'lote ativo', 'lotes ativos')}</p>
        </div>
      )}
      {base.erros > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 p-3 dark:border-rose-500/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"><TriangleAlert className="size-4" /> {plural(base.erros, 'documento com erro', 'documentos com erro')}</p>
            <Botao tamanho="sm" onClick={() => onTentar({ base_id: base.base_id })} disabled={ocupado}><RotateCcw className="size-3" /> Tentar todos de novo</Botao>
          </div>
          <ul className="mt-2 divide-y divide-slate-100 text-xs dark:divide-slate-800">
            {base.ultimos_erros.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate font-mono" title={d.caminho}>{d.caminho}{d.tipo_documento ? <span className="ml-1 font-sans text-slate-400">({rotuloTipo(d.tipo_documento)})</span> : null}</p>
                  {d.motivo && <p className="text-slate-500 dark:text-slate-400">{d.motivo}</p>}
                </div>
                <Botao tamanho="sm" variante="fantasma" onClick={() => onTentar({ documento_ids: [d.id] })} disabled={ocupado}>Tentar de novo</Botao>
              </li>
            ))}
          </ul>
          {base.erros > base.ultimos_erros.length && (
            <Link href={`/anexo?base=${encodeURIComponent(base.base_id)}`} className="mt-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400">e mais {base.erros - base.ultimos_erros.length}…</Link>
          )}
        </div>
      )}
    </div>
  );
}

export function Lotes() {
  const [dados, setDados] = useState<Acompanhamento | null>(null);
  const [mais, setMais] = useState<BaseEmAcompanhamento[]>([]);
  const [paginaMais, setPaginaMais] = useState(1);
  const [temMais, setTemMais] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Bases Recentes (as 5 primeiras) e a primeira página de "Mais Bases". */
  const carregar = useCallback(async () => {
    try {
      const r = await apiLotes.acompanhamento(1, 10);
      setDados(r);
      setMais(r.bases.slice(RECENTES));
      setPaginaMais(1);
      setTemMais(r.tem_mais);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Erro ao carregar dados.');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    // Atualiza a cada 30 s enquanto a aba está visível.
    const i = setInterval(() => { if (document.visibilityState === 'visible') void carregar(); }, ATUALIZAR_MS);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [carregar]);

  async function atualizar() {
    setAtualizando(true);
    await carregar();
    setAtualizando(false);
    setAviso('Dados atualizados.');
  }

  async function carregarMais() {
    try {
      const r = await apiLotes.acompanhamento(paginaMais + 1, 10);
      setMais((x) => [...x, ...r.bases]);
      setPaginaMais(paginaMais + 1);
      setTemMais(r.tem_mais);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Erro ao carregar mais bases.');
    }
  }

  async function tentar(corpo: { documento_ids?: number[]; base_id?: string }) {
    setOcupado(true);
    try {
      const r = await apiLotes.tentarDeNovo(corpo);
      setAviso(`${plural(r.reenfileirados, 'documento voltou', 'documentos voltaram')} para a fila.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível pôr na fila de novo.');
    } finally {
      setOcupado(false);
    }
  }

  const recentes = dados?.bases.slice(0, RECENTES) ?? [];
  const algumaAtiva = (dados?.totais.total ?? 0) > 0;

  return (
    <Pagina
      titulo="Acompanhamento de Lotes"
      subtitulo="Monitore o progresso dos arquivos em tempo real. A tela se atualiza sozinha a cada 30 segundos."
      acoes={<Botao variante="primario" onClick={atualizar} disabled={atualizando}><RefreshCw className={atualizando ? 'size-4 animate-spin' : 'size-4'} /> {atualizando ? 'Atualizando…' : 'Atualizar Dados'}</Botao>}
    >
      <div className="mb-4 space-y-2">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {aviso && !erro && <Aviso tipo="ok">{aviso}</Aviso>}
      </div>
      {!dados && !erro && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando acompanhamento dos lotes…</p>}
      {dados && (
        <>
          <h2 className="mb-3 font-display text-xl">Resumo Geral</h2>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador rotulo={<span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> Lotes Pendentes</span>} valor={dados.totais.pending} detalhe="Aguardando processamento" cor="ambar" />
            <Indicador rotulo={<span className="inline-flex items-center gap-1"><Activity className="size-3.5" /> Em Processamento</span>} valor={dados.totais.processing} detalhe="Sendo executados agora" cor="indigo" />
            <Indicador rotulo={<span className="inline-flex items-center gap-1"><Database className="size-3.5" /> Total de Lotes Ativos</span>} valor={dados.totais.total} detalhe="Pendentes + Processando" />
            <Indicador rotulo={<span className="inline-flex items-center gap-1"><TriangleAlert className="size-3.5" /> Com erro</span>} valor={dados.totais.erros} detalhe="Use “Tentar de novo”" cor="rosa" />
          </div>

          {!algumaAtiva && (
            <div className="mb-8">
              <Vazio icone={<IconeRabisco tipo="spiral" tamanho={44} />} titulo="Não há lotes com status pendente ou processando no momento">
                Envie documentos em <Link href="/anexo" className="font-semibold underline"><Upload className="inline size-3.5" /> Gestão › Anexo</Link>.
              </Vazio>
            </div>
          )}

          {recentes.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-display text-xl">Bases Recentes</h2>
                <Etiqueta>{plural(recentes.length, 'base', 'bases')}</Etiqueta>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">{recentes.map((b) => <CartaoBase key={b.base_id} base={b} onTentar={tentar} ocupado={ocupado} />)}</div>
            </section>
          )}

          {mais.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-display text-xl">Mais Bases</h2>
                <Etiqueta>{plural(mais.length, 'base', 'bases')}</Etiqueta>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">{mais.map((b) => <CartaoBase key={b.base_id} base={b} onTentar={tentar} ocupado={ocupado} />)}</div>
              <div className="mt-4 text-center">
                {temMais ? <Botao onClick={carregarMais}>Carregar mais bases</Botao> : <p className="text-sm text-slate-500 dark:text-slate-400">Todos os lotes foram carregados.</p>}
              </div>
            </section>
          )}
        </>
      )}
    </Pagina>
  );
}
