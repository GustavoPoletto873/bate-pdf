'use client';

import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Link2, Undo2 } from 'lucide-react';
import { camposDoLado, CAMPO_POR_ID, ROTULO_LADO, valorDaAmostra, type CampoId, type Lado } from '@/lib/campos';
import type { OperacaoMarcacao, PendenciaLinha, PedidoVinculo } from '@/lib/repo';
import type { CandidatoSugerido, ResultadoPreClassificacaoTela, SugestaoTitulo } from '@/lib/cliente';
import { exibirValor } from '@/lib/exibir';
import { formatarData, formatarMoeda } from '@/lib/valores';
import { Botao, cx, Dialogo, Etiqueta } from '@/components/ui';
import { Recorte } from '@/components/pdf/Recorte';
import {
  agruparPorMotivo, candidatoPrincipal, deixadoPendente, motivoSemConfirmacao, planejarMarcacoesPendentes,
  planejarMarcacoesSugeridas, recortesDoCandidato, ROTULO_AVISO, ROTULO_CONFIANCA, ROTULO_REGRA, type Grupo,
} from '@/components/bater/preClassificacao';

const EXEMPLOS_POR_MOTIVO = 2;
const ORDEM_DECISAO: Record<string, number> = { decidir: 0, revisar: 1, pendente: 2, confirmar: 3 };
const ROTULO_DECISAO: Record<string, { texto: string; cor: 'amber' | 'rose' | 'emerald' | 'orange' }> = {
  revisar: { texto: 'conferir', cor: 'amber' },
  decidir: { texto: 'decidir', cor: 'orange' },
  pendente: { texto: 'não vincular', cor: 'rose' },
  confirmar: { texto: 'pronto', cor: 'emerald' },
};

/**
 * Conferência em lote (ConferenciaPreClassificacao.jsx do Bate Lastro): o grupo
 * (mesmo motivo) decide, e a marcação de cada cartão diz quem vincula. Nos
 * grupos prontos todos já vêm marcados; nos "para decidir", nenhum. "Vincular N"
 * grava as sugestões dos marcados e vincula; "Deixar pendente" grava P nos não
 * marcados. Nada é vinculado sem estar marcado e sem confirmar.
 */
export function Conferencia({ pre, pendencias, ocupado, onMarcar, onVincular, onAbrirNoBater, avisar }: {
  baseId: string;
  pre: ResultadoPreClassificacaoTela;
  pendencias: PendenciaLinha[];
  ocupado: boolean;
  onMarcar: (ops: OperacaoMarcacao[]) => Promise<void>;
  onVincular: (itens: PedidoVinculo[]) => Promise<{ vinculados: number; recusados: { pendencia_id: number; motivo: string }[] }>;
  onAbrirNoBater: (pendenciaId: number, pdfId: number | null, pagina: number | null) => void;
  avisar: (tipo: 'ok' | 'erro' | 'alerta' | 'info', texto: string) => void;
}) {
  const nomes = pre.nomes_pdfs ?? {};
  // Pendências ainda abertas, por título: a conferência só mostra o que falta.
  const abertasPorTitulo = useMemo(() => {
    const m = new Map<number, PendenciaLinha[]>();
    for (const p of pendencias) if (p.situacao === 'pendente') m.set(p.titulo_id, [...(m.get(p.titulo_id) ?? []), p]);
    return m;
  }, [pendencias]);
  const todasPorTitulo = useMemo(() => {
    const m = new Map<number, PendenciaLinha[]>();
    for (const p of pendencias) m.set(p.titulo_id, [...(m.get(p.titulo_id) ?? []), p]);
    return m;
  }, [pendencias]);

  const abertas = useMemo(() => pre.resultados.filter((s) => abertasPorTitulo.has(s.registro_base_id)), [pre, abertasPorTitulo]);
  // Com documento sugerido para algum lado ainda aberto.
  const temCandidatoAberto = (s: SugestaoTitulo) => (abertasPorTitulo.get(s.registro_base_id) ?? []).some((p) => s.candidatos?.[p.lado]);
  const lista = useMemo(() => abertas.filter((s) => candidatoPrincipal(s) && temCandidatoAberto(s)), [abertas]); // eslint-disable-line react-hooks/exhaustive-deps
  const semPdf = useMemo(() => abertas.filter((s) => !candidatoPrincipal(s) || !temCandidatoAberto(s)), [abertas]); // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => {
    // A mesma CCB sugerida para várias parcelas fica junta: confere uma vez.
    const contagem = new Map<string, number>();
    for (const s of lista) {
      const pdf = String(s.candidatos?.lastro?.processed_pdf ?? '');
      if (pdf) contagem.set(pdf, (contagem.get(pdf) ?? 0) + 1);
    }
    const ordenada = lista.map((s, i) => ({ s, i })).sort((a, b) => {
      const pa = String(a.s.candidatos?.lastro?.processed_pdf ?? '');
      const pb = String(b.s.candidatos?.lastro?.processed_pdf ?? '');
      if (pa === pb) return a.i - b.i;
      return (contagem.get(pb) ?? 0) - (contagem.get(pa) ?? 0) || pa.localeCompare(pb);
    }).map(({ s }) => s);
    return agruparPorMotivo(ordenada);
  }, [lista]);
  const paraDecidir = useMemo(() => grupos.filter((g) => g.motivo.decisao !== 'confirmar')
    .sort((a, b) => (ORDEM_DECISAO[a.motivo.decisao] ?? 1) - (ORDEM_DECISAO[b.motivo.decisao] ?? 1) || b.itens.length - a.itens.length), [grupos]);
  const prontos = useMemo(() => grupos.filter((g) => g.motivo.decisao === 'confirmar'), [grupos]);

  const ehDeixadoPendente = (id: number) => {
    const ps = abertasPorTitulo.get(id) ?? [];
    return ps.length > 0 && ps.every(deixadoPendente);
  };
  const [marcados, setMarcados] = useState<Set<number>>(() => new Set(
    grupos.filter((g) => g.motivo.decisao === 'confirmar').flatMap((g) => g.itens.map((s) => s.registro_base_id)).filter((id) => !ehDeixadoPendente(id)),
  ));
  const [abertosGrupos, setAbertosGrupos] = useState<Set<string>>(new Set());
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [semPdfAberto, setSemPdfAberto] = useState(false);
  const [confirmar, setConfirmar] = useState<{ ids: number[]; titulo: string } | null>(null);

  const alternar = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, chave: string) =>
    setter((a) => { const n = new Set(a); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });

  // ----------------------------------------------------------- vincular / pendente

  async function vincularTitulos(ids: number[]) {
    const porId = new Map(pre.resultados.map((s) => [s.registro_base_id, s]));
    const ops: OperacaoMarcacao[] = [];
    const itens: PedidoVinculo[] = [];
    for (const id of ids) {
      const s = porId.get(id);
      const ps = abertasPorTitulo.get(id) ?? [];
      if (!s) continue;
      // Grava a sugestão por cima do P de quem tinha sido deixado pendente (a pessoa marcou o título de novo).
      ops.push(...planejarMarcacoesSugeridas(s, ps, { sobrescrever: ps.every(deixadoPendente) }));
      for (const p of ps) {
        const c = s.candidatos?.[p.lado];
        if (c) itens.push({ pendencia_id: p.pendencia_id, pdf_id: Number(c.processed_pdf), pagina: Number(c.pagina) || null, origem: 'conferencia' });
      }
    }
    await onMarcar(ops);
    if (!itens.length) {
      avisar('alerta', 'Nenhum dos títulos marcados tem PDF sugerido para os lados que faltam.');
      return;
    }
    try {
      const r = await onVincular(itens);
      avisar('ok', `${r.vinculados} pendência(s) vinculada(s).`);
      setMarcados((a) => { const n = new Set(a); ids.forEach((id) => n.delete(id)); return n; });
    } catch (e) {
      const recusados = ((e as { dados?: { recusados?: { motivo: string }[] } }).dados?.recusados) ?? [];
      avisar('alerta', `Nada foi vinculado: ${recusados.slice(0, 3).map((r) => r.motivo).join('; ') || (e as Error).message}. Algum campo ficou sem V/D — abra o título no Bater PDF.`);
    }
  }

  async function deixarPendente(itens: SugestaoTitulo[]) {
    const ps = itens.flatMap((s) => abertasPorTitulo.get(s.registro_base_id) ?? []);
    const ops = planejarMarcacoesPendentes(ps);
    if (!ops.length) return;
    await onMarcar(ops);
    avisar('ok', `${itens.length} título(s) deixado(s) pendente(s) (P).`);
  }

  // ----------------------------------------------------------- tela

  const renderGrupo = ({ motivo, itens }: Grupo) => {
    const aberto = abertosGrupos.has(motivo.chave);
    const expandido = expandidos.has(motivo.chave);
    const mostrados = !aberto ? [] : expandido ? itens : itens.slice(0, EXEMPLOS_POR_MOTIVO);
    const ids = itens.map((s) => s.registro_base_id);
    const marcadosDoGrupo = ids.filter((id) => marcados.has(id));
    const naoMarcados = itens.filter((s) => !marcados.has(s.registro_base_id) && !ehDeixadoPendente(s.registro_base_id));
    const decisao = ROTULO_DECISAO[motivo.decisao];
    return (
      <section key={motivo.chave} className="lastro-cartao">
        <div className="flex flex-wrap items-start gap-3 p-3">
          <input
            type="checkbox"
            className="mt-1"
            aria-label="Marcar todos do grupo"
            checked={marcadosDoGrupo.length === ids.length}
            ref={(el) => { if (el) el.indeterminate = marcadosDoGrupo.length > 0 && marcadosDoGrupo.length < ids.length; }}
            onChange={(e) => setMarcados((a) => { const n = new Set(a); ids.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n; })}
          />
          <div className="min-w-0 flex-1">
            <button type="button" className="flex items-start gap-1 text-left" onClick={() => alternar(setAbertosGrupos, motivo.chave)}>
              {aberto ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
              <span className="font-medium">{motivo.titulo}</span>
            </button>
            <p className="mt-0.5 pl-5 text-xs text-slate-500 dark:text-slate-400">{motivo.explicacao}</p>
            <p className="mt-1 pl-5 text-xs">
              <Etiqueta cor={decisao?.cor ?? 'amber'}>{decisao?.texto ?? motivo.decisao}</Etiqueta>{' '}
              <span className="text-slate-600 dark:text-slate-300">{itens.length} título(s) · {marcadosDoGrupo.length ? `${marcadosDoGrupo.length} marcado(s) para vincular` : 'nenhum marcado — marque os que conferem'}</span>
              {!aberto && <button type="button" className="ml-2 text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => alternar(setAbertosGrupos, motivo.chave)}>ver exemplos</button>}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Botao tamanho="sm" variante="primario" disabled={ocupado || !marcadosDoGrupo.length} onClick={() => setConfirmar({ ids: marcadosDoGrupo, titulo: motivo.titulo })}>
              <Link2 className="size-3.5" /> Vincular {marcadosDoGrupo.length || ''}
            </Botao>
            <Botao tamanho="sm" variante="fantasma" disabled={ocupado || !naoMarcados.length} onClick={() => deixarPendente(naoMarcados)} title="Grava P nos títulos não marcados: o documento certo não está na base">
              <Undo2 className="size-3.5" /> Deixar pendente ({naoMarcados.length})
            </Botao>
          </div>
        </div>
        {aberto && (
          <div className="grid gap-3 border-t border-slate-100 p-3 dark:border-slate-800 xl:grid-cols-2">
            {mostrados.map((s) => (
              <Cartao
                key={s.registro_base_id}
                sugestao={s}
                pendencias={todasPorTitulo.get(s.registro_base_id) ?? []}
                abertas={abertasPorTitulo.get(s.registro_base_id) ?? []}
                nomes={nomes}
                marcado={marcados.has(s.registro_base_id)}
                onAlternar={(id) => setMarcados((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                onAbrirNoBater={onAbrirNoBater}
              />
            ))}
            {itens.length > EXEMPLOS_POR_MOTIVO && (
              <button type="button" className="text-left text-xs text-indigo-600 hover:underline dark:text-indigo-400 xl:col-span-2" onClick={() => alternar(setExpandidos, motivo.chave)}>
                {expandido ? 'mostrar só os exemplos' : `mostrar todos os ${itens.length}`}
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  const marcadosProntos = prontos.flatMap((g) => g.itens.map((s) => s.registro_base_id).filter((id) => marcados.has(id)));
  const total = (gs: Grupo[]) => gs.reduce((n, g) => n + g.itens.length, 0);

  return (
    <div className="rolagem-fina min-h-0 flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Etiqueta cor="amber">{total(paraDecidir)} para decidir</Etiqueta>
          <Etiqueta cor="emerald">{total(prontos)} prontos</Etiqueta>
          <Etiqueta cor="rose">{semPdf.length} sem PDF encontrado</Etiqueta>
          <span className="text-slate-500">{pre.pdfs_analisados} PDFs · {pre.paginas_analisadas} páginas analisadas. Títulos já batidos saem desta tela sozinhos.</span>
        </div>

        {paraDecidir.length > 0 && (
          <div className="space-y-3">
            <div>
              <h2 className="font-display text-lg tracking-tight">Para decidir</h2>
              <p className="text-xs text-slate-500">Confiança baixa/ambígua, documento com aviso, cessionário diferente ou divergência sem regra. Abra os exemplos, marque o que confere.</p>
            </div>
            {paraDecidir.map(renderGrupo)}
          </div>
        )}

        {prontos.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-display text-lg tracking-tight">Prontos para vincular</h2>
                <p className="text-xs text-slate-500">A leitura confere, ou a correção segue uma regra combinada com o time. Já vêm marcados: desmarque o que não quiser.</p>
              </div>
              <Botao variante="sucesso" tamanho="sm" disabled={ocupado || !marcadosProntos.length} onClick={() => setConfirmar({ ids: marcadosProntos, titulo: `Todos os marcados dos ${prontos.length} grupo(s) prontos` })}>
                <Link2 className="size-3.5" /> Vincular todos os prontos ({marcadosProntos.length})
              </Botao>
            </div>
            {prontos.map(renderGrupo)}
          </div>
        )}

        {lista.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-slate-300 p-6 text-center font-serif text-sm text-slate-500 dark:border-slate-700">Nenhum título com PDF sugerido ainda aberto.</p>
        )}

        {semPdf.length > 0 && (
          <div className="space-y-2">
            <button type="button" className="flex items-center gap-1 font-display tracking-tight" onClick={() => setSemPdfAberto((a) => !a)}>
              {semPdfAberto ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Sem PDF encontrado ({semPdf.length})
            </button>
            <p className="text-xs text-slate-500">Nenhum documento da base traz este título — ou o PDF é escaneado (sem texto). Abra no Bater PDF para procurar à mão.</p>
            {semPdfAberto && (
              <ul className="grid gap-1 sm:grid-cols-2">
                {semPdf.slice(0, 400).map((s) => {
                  const p = (abertasPorTitulo.get(s.registro_base_id) ?? [])[0];
                  if (!p) return null;
                  return (
                    <li key={s.registro_base_id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900">
                      <span className="font-mono">{p.titulo.numero_documento}</span>
                      <span className="truncate">{p.titulo.sacado_nome}</span>
                      <span className="ml-auto shrink-0 tabular-nums">{formatarMoeda(p.titulo.valor_total)}</span>
                      <button type="button" className="shrink-0 text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onAbrirNoBater(p.pendencia_id, null, null)}>abrir</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <Dialogo
        aberto={!!confirmar}
        titulo="Vincular os títulos marcados?"
        onFechar={() => setConfirmar(null)}
        rodape={(
          <>
            <Botao onClick={() => setConfirmar(null)}>Cancelar</Botao>
            <Botao variante="primario" disabled={ocupado} onClick={async () => { const c = confirmar!; setConfirmar(null); await vincularTitulos(c.ids); }}>
              Gravar e vincular {confirmar?.ids.length}
            </Botao>
          </>
        )}
      >
        <p className="text-sm">{confirmar?.titulo}</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Grava as marcações sugeridas (V/D) nos campos ainda não decididos — campo marcado à mão não é tocado — e vincula cada lado pendente
          ao PDF sugerido. Dá para desfazer cada vínculo depois no Bater PDF.
        </p>
      </Dialogo>
    </div>
  );
}

const Cartao = memo(function Cartao({ sugestao: s, pendencias, abertas, nomes, marcado, onAlternar, onAbrirNoBater }: {
  sugestao: SugestaoTitulo;
  pendencias: PendenciaLinha[];
  abertas: PendenciaLinha[];
  nomes: Record<string, string>;
  marcado: boolean;
  onAlternar: (id: number) => void;
  onAbrirNoBater: (pendenciaId: number, pdfId: number | null, pagina: number | null) => void;
}) {
  const t = pendencias[0]?.titulo;
  const principal = candidatoPrincipal(s);
  const ladoPrincipal: Lado = s.candidatos?.lastro ? 'lastro' : 'termo';
  const ladosAbertos = new Set(abertas.map((p) => p.lado));
  const ladoTermo = ladosAbertos.has('termo');
  const campos = camposDoLado(ladoTermo ? 'termo' : 'lastro');
  const atencao: { campo: CampoId; letra: string; porque: string }[] = [];
  const conferem: CampoId[] = [];
  for (const def of campos) {
    const st = s.campos?.[def.campo];
    if (!st) continue;
    const semConf = motivoSemConfirmacao(st);
    const alerta = st.alerta && !(st.alerta as { informativo?: boolean }).informativo;
    if (st.valor === 'V' && !semConf && !alerta) { conferem.push(def.campo); continue; }
    let porque = '';
    if (st.valor === 'D') porque = st.encontrado ? `documento traz ${exibirValor(def.campo, String(st.encontrado))}` : 'não achado no documento';
    if (semConf) porque = semConf.texto;
    if (alerta) porque = `documento traz outra data${st.encontrado ? ` (${exibirValor(def.campo, String(st.encontrado))})` : ''}`;
    if (st.regra) porque += `${porque ? ' · ' : ''}${ROTULO_REGRA[String(st.regra)] ?? st.regra}`;
    atencao.push({ campo: def.campo, letra: semConf ? 'V?' : st.valor, porque });
  }
  const recortes = recortesDoCandidato(principal).slice(0, 2);
  const pendenciaPrincipal = abertas.find((p) => p.lado === ladoPrincipal) ?? abertas[0];

  return (
    <div className={cx('rounded-md border p-3 text-xs', marcado ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-500/50 dark:bg-indigo-500/5' : 'border-slate-200 dark:border-slate-800')}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={marcado} onChange={() => onAlternar(s.registro_base_id)} aria-label="Marcar para vincular" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono font-semibold">{t?.numero_documento}</span>
            <span className="truncate font-medium">{t?.sacado_nome}</span>
            <span className="tabular-nums">{formatarMoeda(t?.valor_total)}</span>
            <span className="text-slate-500">venc. {formatarData(t?.data_vencimento)}</span>
            {pendencias.length && abertas.every(deixadoPendente) ? <Etiqueta cor="rose">deixado pendente (P)</Etiqueta> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(['termo', 'lastro'] as Lado[]).filter((l) => ladosAbertos.has(l)).map((lado) => {
              const c = s.candidatos?.[lado] as CandidatoSugerido | undefined;
              const conf = String(c?.confianca ?? 'sem_candidato');
              return (
                <span key={lado} className="inline-flex items-center gap-1">
                  <Etiqueta cor={c ? (ROTULO_CONFIANCA[conf]?.cor ?? 'slate') : 'rose'} titulo={c ? `Confiança ${ROTULO_CONFIANCA[conf]?.texto}` : 'Nenhum PDF achado'}>
                    {ROTULO_LADO[lado]}: {c ? `${nomes[String(c.processed_pdf)] ?? `PDF ${c.processed_pdf}`} · p.${String(c.pagina)}` : 'sem PDF'}
                  </Etiqueta>
                  {c?.aviso ? <Etiqueta cor="rose">{ROTULO_AVISO[String(c.aviso)] ?? String(c.aviso)}</Etiqueta> : null}
                </span>
              );
            })}
            {pendencias.some((p) => p.situacao === 'vinculado') && <Etiqueta cor="emerald">{pendencias.filter((p) => p.situacao === 'vinculado').map((p) => ROTULO_LADO[p.lado]).join(' e ')} já vinculado</Etiqueta>}
          </div>
        </div>
        {pendenciaPrincipal && (
          <button type="button" title="Abrir no Bater PDF" className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 dark:hover:bg-slate-800"
            onClick={() => onAbrirNoBater(pendenciaPrincipal.pendencia_id, principal ? Number(principal.processed_pdf) : null, principal ? Number(principal.pagina) || null : null)}>
            <ExternalLink className="size-4" />
          </button>
        )}
      </div>

      {atencao.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {atencao.map((a) => (
            <li key={a.campo} className="flex gap-1.5">
              <span className={cx('w-6 shrink-0 text-center font-bold', a.letra === 'D' ? 'text-amber-700 dark:text-amber-400' : 'text-violet-700 dark:text-violet-300')}>{a.letra}</span>
              <span className="shrink-0 font-medium">{CAMPO_POR_ID[a.campo].rotulo}</span>
              <span className="text-slate-600 dark:text-slate-400">· amostra {exibirValor(a.campo, valorDaAmostra(t ?? {}, a.campo)) || 'vazia'} · {a.porque}</span>
            </li>
          ))}
        </ul>
      )}
      {conferem.length > 0 && (
        <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">V {conferem.map((c) => CAMPO_POR_ID[c].curto).join(' · ')}</p>
      )}
      {principal && recortes.length > 0 && (
        <div className="mt-2 grid gap-2">
          {recortes.map((r) => (
            <Recorte key={`${r.pdf}-${r.pagina}`} pdfId={Number(r.pdf)} pagina={r.pagina} trechos={r.trechos} regiao={r.regiao}
              onClick={() => pendenciaPrincipal && onAbrirNoBater(pendenciaPrincipal.pendencia_id, Number(r.pdf), r.pagina)} />
          ))}
        </div>
      )}
    </div>
  );
});
