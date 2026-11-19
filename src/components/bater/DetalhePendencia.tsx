'use client';

import { useState } from 'react';
import { Eraser, FileSearch, Link2, Link2Off, Search, Sparkles, Undo2 } from 'lucide-react';
import { camposDoLado, CAMPO_POR_ID, ROTULO_LADO, valorDaAmostra, VEREDITOS, type CampoId, type DefCampo, type Veredito } from '@/lib/campos';
import type { OperacaoMarcacao, PendenciaLinha } from '@/lib/repo';
import type { SugestaoTitulo } from '@/lib/cliente';
import { exibirValor, valorDigitadoParaGravar, valorParaEditar } from '@/lib/exibir';
import { termosDeBusca } from '@/lib/busca';
import { Botao, cx, Etiqueta, Selo } from '@/components/ui';
import {
  candidatoDoLado, formatarFonte, motivoSemConfirmacao, planejarMarcacoesSugeridas,
  ROTULO_AVISO, ROTULO_CONFIANCA, ROTULO_REGRA,
} from '@/components/bater/preClassificacao';

export type PdfAberto = { pdf_id: number; nome: string; pagina: number | null; termo: string | null };

export function DetalhePendencia({
  baseId, linha, sugestao, nomesPdfs, pdfAberto, ocupado,
  onMarcar, onBuscar, onAbrirPdf, onVincular, onDesvincular,
}: {
  /** Para o link do pré-bate na Gestão de Bates. */
  baseId?: string;
  linha: PendenciaLinha;
  sugestao?: SugestaoTitulo;
  nomesPdfs: Record<string, string>;
  pdfAberto: PdfAberto | null;
  ocupado: boolean;
  onMarcar: (ops: OperacaoMarcacao[]) => void;
  onBuscar: (termos: string[], rotulo: string) => void;
  onAbrirPdf: (pdfId: number, pagina: number | null, termo?: string | null) => void;
  /** `antes`: marcações a gravar antes de vincular (a sugestão, no "Aplicar sugestão e vincular"). */
  onVincular: (pdfId: number, pagina: number | null, antes?: OperacaoMarcacao[]) => void;
  onDesvincular: () => void;
}) {
  const campos = camposDoLado(linha.lado);
  const vinculado = linha.situacao !== 'pendente';
  const candidato = candidatoDoLado(sugestao, linha.lado);
  const t = linha.titulo;

  const marcar = (campo: CampoId, valor: Veredito | null, valor_digitado?: string | null) =>
    onMarcar([{ pendencia_id: linha.pendencia_id, campo, valor, valor_digitado: valor === 'D' ? (valor_digitado ?? linha.marcacoes[campo]?.valor_digitado ?? '') : null }]);

  const indecisos = campos.filter((c) => !linha.marcacoes[c.campo]);
  // Sugestão em lote só com documento achado para este lado; sem documento, a pessoa decide campo a campo.
  const opsSugestao = sugestao && candidato ? planejarMarcacoesSugeridas(sugestao, [linha]) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <Etiqueta cor={linha.lado === 'termo' ? 'violet' : 'sky'}>{ROTULO_LADO[linha.lado]}</Etiqueta>
        <span className="font-mono text-sm font-bold">{t.numero_documento}</span>
        <span className="truncate text-sm text-slate-600 dark:text-slate-300">{t.sacado_nome}</span>
        {t.id_base_origem && <span className="text-[11px] text-slate-400">ID_BASE {t.id_base_origem}</span>}
        {linha.situacao === 'ja_batido' && <Etiqueta cor="emerald">já batido no Bate Lastro</Etiqueta>}
        <div className="ml-auto flex flex-wrap gap-1">
          <Botao tamanho="sm" onClick={() => onBuscar(termosDeBusca('numero_documento', t.numero_documento), 'Nº do documento')} title="Procura o nº nos PDFs da base">
            <Search className="size-3.5" /> Buscar nº
          </Botao>
          <Botao tamanho="sm" onClick={() => onBuscar(termosDeBusca('sacado_documento', t.sacado_documento), 'CPF/CNPJ do sacado')} title="Procura o CPF/CNPJ do sacado nos PDFs">
            <Search className="size-3.5" /> Buscar CPF
          </Botao>
        </div>
      </div>

      {linha.pre_bate && !vinculado && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-medium">Pré-bate do Processar Base</span>
          <span>leitura nº <b className="font-mono">{linha.pre_bate.numero_documento ?? '—'}</b> · critério {linha.pre_bate.criterio ?? '—'}</span>
          {linha.pre_bate.pdf_id && (
            <button type="button" className="truncate underline decoration-dotted hover:text-amber-700 dark:hover:text-amber-100" onClick={() => onAbrirPdf(linha.pre_bate!.pdf_id!, 1)}>
              {linha.pre_bate.pdf_nome ?? `PDF ${linha.pre_bate.pdf_id}`}
            </button>
          )}
          {baseId && <a href={`/pre-matches?base=${baseId}`} className="ml-auto underline decoration-dotted">confirmar ou rejeitar na Gestão de Bates</a>}
        </div>
      )}

      {sugestao && !vinculado && (
        <div className="flex flex-wrap items-center gap-2 border-b border-violet-200 bg-violet-50/60 px-3 py-1.5 text-xs dark:border-violet-500/30 dark:bg-violet-500/10">
          <Sparkles className="size-3.5 text-violet-600" />
          <span className="font-medium text-violet-900 dark:text-violet-200">Pré-classificação</span>
          {candidato ? (
            <>
              <Etiqueta cor={ROTULO_CONFIANCA[String(candidato.confianca)]?.cor ?? 'slate'}>{ROTULO_CONFIANCA[String(candidato.confianca)]?.texto ?? String(candidato.confianca)}</Etiqueta>
              <button type="button" className="truncate text-violet-800 underline decoration-dotted hover:text-violet-600 dark:text-violet-200" onClick={() => onAbrirPdf(Number(candidato.processed_pdf), Number(candidato.pagina) || null)}>
                {nomesPdfs[String(candidato.processed_pdf)] ?? `PDF ${candidato.processed_pdf}`}, pág. {String(candidato.pagina)}
              </button>
              {candidato.aviso ? <Etiqueta cor="rose">{ROTULO_AVISO[String(candidato.aviso)] ?? String(candidato.aviso)}</Etiqueta> : null}
              {candidato.regra ? <Etiqueta cor="slate" titulo={ROTULO_REGRA[String(candidato.regra)]}>{String(candidato.regra)}</Etiqueta> : null}
            </>
          ) : <span className="text-violet-800 dark:text-violet-200">nenhum PDF de {ROTULO_LADO[linha.lado].toLowerCase()} achado para este título</span>}
          <div className="ml-auto flex gap-1">
            {opsSugestao.length > 0 && (
              <Botao tamanho="sm" onClick={() => onMarcar(opsSugestao)} disabled={ocupado} title="Grava as sugestões V/D nos campos ainda não decididos">
                Aplicar sugestão ({opsSugestao.length})
              </Botao>
            )}
          </div>
        </div>
      )}

      <div className="rolagem-fina min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="lastro-rotulo sticky top-0 z-10 bg-white text-left dark:bg-slate-950">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-3 py-1.5">Campo</th>
              <th className="px-2 py-1.5">Amostra</th>
              <th className="px-2 py-1.5">No documento</th>
              <th className="px-2 py-1.5 text-center">V/D/P</th>
            </tr>
          </thead>
          <tbody>
            {campos.map((c) => (
              <LinhaCampo
                key={c.campo}
                def={c}
                linha={linha}
                sugestao={sugestao}
                nomesPdfs={nomesPdfs}
                somenteLeitura={vinculado}
                onMarcar={(v, d) => marcar(c.campo, v, d)}
                onBuscar={() => onBuscar(termosDeBusca(c.campo, valorDaAmostra(t, c.campo)), c.rotulo)}
                onAbrirEvidencia={(pdf, pagina) => onAbrirPdf(pdf, pagina, null)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-800">
        {linha.situacao === 'vinculado' && linha.vinculo ? (
          <>
            <span className="text-xs text-slate-600 dark:text-slate-300">
              Batido com{' '}
              {linha.vinculo.pdf_id ? (
                <button type="button" className="font-medium underline decoration-dotted" onClick={() => onAbrirPdf(linha.vinculo!.pdf_id!, linha.vinculo!.pagina)}>
                  {linha.vinculo.pdf_nome}{linha.vinculo.pagina ? `, pág. ${linha.vinculo.pagina}` : ''}
                </button>
              ) : 'documento sem PDF'}
              {' '}em {new Date(linha.vinculo.criado_em).toLocaleString('pt-BR')}
            </span>
            <Botao tamanho="sm" variante="fantasma" className="ml-auto" onClick={onDesvincular} disabled={ocupado}><Link2Off className="size-3.5" /> Desfazer vínculo</Botao>
          </>
        ) : linha.situacao === 'pendente' ? (
          <>
            <Botao tamanho="sm" onClick={() => onMarcar(indecisos.map((c) => ({ pendencia_id: linha.pendencia_id, campo: c.campo, valor: 'V' as Veredito })))} disabled={ocupado || !indecisos.length} title="V nos campos ainda não decididos">
              V nos não decididos
            </Botao>
            <Botao tamanho="sm" variante="fantasma" onClick={() => onMarcar(indecisos.map((c) => ({ pendencia_id: linha.pendencia_id, campo: c.campo, valor: 'P' as Veredito })))} disabled={ocupado || !indecisos.length} title="O documento certo não está na base: deixa os campos em P">
              <Undo2 className="size-3.5" /> Deixar pendente
            </Botao>
            <Botao tamanho="sm" variante="fantasma" onClick={() => onMarcar(campos.filter((c) => linha.marcacoes[c.campo]).map((c) => ({ pendencia_id: linha.pendencia_id, campo: c.campo, valor: null })))} disabled={ocupado || !Object.keys(linha.marcacoes).length}>
              <Eraser className="size-3.5" /> Limpar
            </Botao>
            <div className="ml-auto flex gap-2">
              {candidato && (!pdfAberto || String(pdfAberto.pdf_id) !== String(candidato.processed_pdf)) && (
                <Botao
                  tamanho="sm"
                  onClick={() => onVincular(Number(candidato.processed_pdf), Number(candidato.pagina) || null, opsSugestao)}
                  disabled={ocupado}
                  title="Grava a sugestão nos campos ainda não decididos (o que você marcou fica) e vincula ao PDF sugerido"
                >
                  <Link2 className="size-3.5" /> {opsSugestao.length ? 'Aplicar sugestão e vincular' : 'Vincular ao sugerido'}
                </Botao>
              )}
              <Botao tamanho="sm" variante="primario" onClick={() => pdfAberto && onVincular(pdfAberto.pdf_id, pdfAberto.pagina)} disabled={ocupado || !pdfAberto} title={pdfAberto ? `Vincular a ${pdfAberto.nome}` : 'Abra um PDF à direita para vincular'}>
                <Link2 className="size-3.5" /> {pdfAberto ? `Vincular a ${pdfAberto.nome.length > 28 ? `${pdfAberto.nome.slice(0, 26)}…` : pdfAberto.nome}` : 'Abra um PDF para vincular'}
              </Botao>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function LinhaCampo({ def, linha, sugestao, nomesPdfs, somenteLeitura, onMarcar, onBuscar, onAbrirEvidencia }: {
  def: DefCampo;
  linha: PendenciaLinha;
  sugestao?: SugestaoTitulo;
  nomesPdfs: Record<string, string>;
  somenteLeitura: boolean;
  onMarcar: (valor: Veredito | null, valorDigitado?: string | null) => void;
  onBuscar: () => void;
  onAbrirEvidencia: (pdfId: number, pagina: number) => void;
}) {
  const campo = def.campo;
  const amostra = valorDaAmostra(linha.titulo, campo);
  const manual = linha.marcacoes[campo];
  const doVinculo = linha.vinculo?.marcacoes[campo];
  const st = sugestao?.campos?.[campo];
  const sugerido = !manual && !somenteLeitura && st && (st.valor === 'V' || st.valor === 'D') ? st.valor : null;
  const valor = somenteLeitura ? (doVinculo ?? null) : (manual?.valor ?? sugerido);
  const semConf = motivoSemConfirmacao(st);
  const regra = st?.regra ? String(st.regra) : null;

  // Página da evidência (o motor guarda [página, início, fim] por campo).
  const evid = (st?.evidencias as unknown as [number, number, number][] | undefined)?.[0];
  const origem = st?.origem ? String(st.origem) : null;
  const candidatoDaOrigem = origem && sugestao?.candidatos?.[origem] ? sugestao.candidatos[origem] : null;
  const fonte = st?.fonte as Record<string, unknown> | null | undefined;

  const dica = [
    regra && (ROTULO_REGRA[regra] ?? regra),
    semConf && `V sem confirmação: ${semConf.texto}`,
    st?.alerta ? ((st.alerta as { informativo?: boolean }).informativo
      ? 'O documento traz outra data; informativo (o time mantém a da amostra)'
      : 'O documento traz outra data: decidir') : null,
    fonte && fonte.tipo !== 'amostra' ? `Fonte: ${formatarFonte(fonte, nomesPdfs)}` : null,
  ].filter(Boolean).join('\n');

  return (
    <tr className="border-b border-slate-100 align-top dark:border-slate-800/60">
      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200">{def.rotulo}</td>
      <td className="px-2 py-1.5">
        <div className="flex items-start gap-1">
          <span className={cx('break-all', !amostra && 'italic text-slate-400')}>{amostra ? exibirValor(campo, amostra) : 'vazio'}</span>
          {amostra && (
            <button type="button" onClick={onBuscar} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 dark:hover:bg-slate-800" title="Procurar este valor nos PDFs (nas formas em que costuma estar impresso)">
              <Search className="size-3" />
            </button>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5">
        {somenteLeitura ? (
          <span>{exibirValor(campo, linha.vinculo?.leitura[campo] ?? null) || <span className="italic text-slate-400">—</span>}</span>
        ) : manual?.valor === 'D' ? (
          <CampoDigitado key={`${linha.pendencia_id}-${campo}-${manual.valor_digitado ?? ''}`} campo={campo} valor={manual.valor_digitado} onSalvar={(v) => onMarcar('D', v)} />
        ) : sugerido ? (
          <div className="flex flex-wrap items-center gap-1 text-violet-800 dark:text-violet-300">
            {st?.valor === 'D' ? (st.encontrado ? <span>doc.: <b>{exibirValor(campo, String(st.encontrado))}</b></span> : <span className="italic">não achado no documento</span>) : <span className="opacity-80">confere</span>}
            {(regra || semConf || st?.alerta) ? (
              <span className="cursor-help rounded bg-violet-100 px-1 text-[10px] dark:bg-violet-500/20" title={dica}>
                {semConf ? 'V?' : st?.alerta ? ((st.alerta as { informativo?: boolean }).informativo ? 'info' : 'alerta') : 'regra'}
              </span>
            ) : null}
            {evid && candidatoDaOrigem && (
              <button type="button" className="rounded p-0.5 hover:bg-violet-100 dark:hover:bg-violet-500/20" title="Abrir onde o motor achou" onClick={() => onAbrirEvidencia(Number(candidatoDaOrigem.processed_pdf), evid[0])}>
                <FileSearch className="size-3" />
              </button>
            )}
          </div>
        ) : manual?.valor === 'V' ? <span className="text-slate-400">confere</span> : null}
      </td>
      <td className="px-2 py-1">
        <div className="flex items-center justify-center gap-1">
          {somenteLeitura ? <Selo valor={valor} tamanho="sm" /> : (['V', 'D', 'P'] as Veredito[]).map((v) => (
            <BotaoVeredito
              key={v}
              letra={v}
              estado={manual?.valor === v ? 'gravado' : sugerido === v ? 'sugerido' : 'livre'}
              onClick={() => {
                if (manual?.valor === v) onMarcar(null);
                else onMarcar(v, v === 'D' ? (manual?.valor_digitado ?? (st?.valor === 'D' ? String(st.encontrado ?? '') : '')) : null);
              }}
            />
          ))}
        </div>
      </td>
    </tr>
  );
}

const DICA_VEREDITO: Record<Veredito, string> = {
  V: 'V — confere',
  D: 'D — divergente (digite ao lado o que o documento traz; vazio = o documento não traz)',
  P: 'P — sem valor / ainda não decidido (bloqueia o vínculo)',
};

/** Botão de uma letra: gravado (cor cheia), sugerido (apagado, contorno roxo) ou livre. Clicar no gravado apaga. */
function BotaoVeredito({ letra, estado, onClick }: { letra: Veredito; estado: 'gravado' | 'sugerido' | 'livre'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={estado === 'sugerido' ? `Sugestão da pré-classificação: ${DICA_VEREDITO[letra]} — clique para gravar` : estado === 'gravado' ? `${DICA_VEREDITO[letra]} (clique de novo para apagar)` : DICA_VEREDITO[letra]}
      className={cx(
        'grid size-6 place-items-center rounded border text-[11px] font-bold leading-none transition',
        estado === 'livre' && 'border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:hover:text-slate-200',
        estado !== 'livre' && VEREDITOS[letra].classe,
        estado === 'sugerido' && 'opacity-60 outline outline-2 outline-offset-1 outline-violet-500/70',
      )}
    >
      {letra}
    </button>
  );
}

function CampoDigitado({ campo, valor, onSalvar }: { campo: CampoId; valor: string | null; onSalvar: (v: string) => void }) {
  const def = CAMPO_POR_ID[campo];
  // Valor novo vindo de fora remonta o campo (key no pai), então o estado inicial basta.
  const [texto, setTexto] = useState(valorParaEditar(campo, valor));
  const [erro, setErro] = useState(false);
  const salvar = () => {
    const v = valorDigitadoParaGravar(campo, texto);
    if (v === null) { setErro(true); return; }
    setErro(false);
    if (v !== (valor ?? '')) onSalvar(v);
  };
  return (
    <div className="flex items-center gap-1">
      <input
        type={def.tipo === 'data' ? 'date' : 'text'}
        value={texto}
        placeholder="o documento não traz"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={cx('h-6 w-full min-w-24 rounded border bg-white px-1.5 text-xs dark:bg-slate-800', erro ? 'border-rose-500' : 'border-amber-300 dark:border-amber-500/50')}
        title="O que o documento traz neste campo (vai como LEITURA_* na volta para o Bate Lastro). Vazio = o documento não traz."
      />
    </div>
  );
}
