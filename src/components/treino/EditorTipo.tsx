'use client';

import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileUp, FlaskConical, Loader2, Save, X } from 'lucide-react';
import { Aviso, Botao, Etiqueta, cx } from '@/components/ui';
import { ErroApi } from '@/lib/cliente';
import { treinoApi, type CampoSpec, type ConfigTipo, type ResultadoTeste, type TipoTreinado } from '@/lib/cliente/treino';

/** Campos da leitura, com os rótulos do Visualizar (camposCanonicos.js do Bate Lastro). */
export const CAMPOS_CANONICOS: { chave: string; rotulo: string; significado: string; exemplo: string; soParcelas?: boolean }[] = [
  { chave: 'NOME_CESSIONARIO', rotulo: 'Nome Cessionário', significado: 'Quem adquire os direitos creditórios (normalmente o fundo/FIDC comprador)', exemplo: "Razão social do fundo no quadro 'Cessionário', 1ª página" },
  { chave: 'DOC_CESSIONARIO', rotulo: 'Doc Cessionário', significado: 'CNPJ do cessionário', exemplo: 'CNPJ ao lado do nome do cessionário' },
  { chave: 'NOME_CEDENTE', rotulo: 'Nome Cedente', significado: 'Quem vende/cede os recebíveis ao cessionário (o credor original do título)', exemplo: "Razão social no quadro 'Credor', 1ª página" },
  { chave: 'DOC_CEDENTE', rotulo: 'Doc Cedente', significado: 'CNPJ ou CPF do cedente', exemplo: 'CNPJ/CPF logo abaixo do nome do cedente' },
  { chave: 'NOME_SACADO', rotulo: 'Nome Sacado', significado: 'Devedor do título — quem tem a obrigação de pagar', exemplo: "Nome do devedor no campo 'Emitente'" },
  { chave: 'DOC_SACADO', rotulo: 'Doc Sacado', significado: 'CPF ou CNPJ do sacado', exemplo: 'CPF/CNPJ do sacado, no cabeçalho do documento' },
  { chave: 'NU_DOCUMENTO', rotulo: 'Nº Documento', significado: 'Número que identifica o título/contrato', exemplo: 'Número do contrato no topo da 1ª página' },
  { chave: 'VALOR_NOMINAL', rotulo: 'Valor Nominal', significado: 'Valor de face do título (ou de cada parcela/título, quando há vários)', exemplo: "Coluna 'Valor' da tabela de parcelas" },
  { chave: 'DATA_AQUISICAO', rotulo: 'Data Aquisição', significado: 'Data em que o cessionário adquiriu o recebível (data da cessão)', exemplo: 'Data da cessão no termo, última página' },
  { chave: 'DATA_EMISSAO', rotulo: 'Data Emissão', significado: 'Data de emissão do título', exemplo: 'Data ao lado da assinatura do emitente' },
  { chave: 'DATA_VENCIMENTO_ORIGINAL', rotulo: 'Data Vencimento', significado: 'Data de vencimento do título (ou de cada parcela/título)', exemplo: "Coluna 'Vencimento' da tabela de parcelas" },
  { chave: 'QUANTIDADE_PARCELAS', rotulo: 'Qtd Parcelas', significado: 'Quantidade total de parcelas do título', exemplo: 'Total de parcelas no quadro-resumo', soParcelas: true },
  { chave: 'NUMERO_PARCELA', rotulo: 'Nº Parcela', significado: 'Número sequencial da parcela', exemplo: "Coluna 'Parcela' da tabela de parcelas", soParcelas: true },
];
const REPETE_LASTRO = ['VALOR_NOMINAL', 'DATA_VENCIMENTO_ORIGINAL'];

const PREFIXO = { termo: 'termo_cessao_', lastro: 'lastro_' } as const;

/** Nome digitado → identificador (limparSlugDigitado do Bate Lastro). */
export function slugDoNome(nome: string): string {
  return nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
}

const vazio = (): Record<string, CampoSpec> => Object.fromEntries(CAMPOS_CANONICOS.map((c) => [c.chave, { presente: false, obrigatorio: true, instrucao: null, repete_por_linha: false }]));

export type OrigemAmostra = { documentoId: number; nome: string } | null;

/**
 * Editor de tipo treinado (TreinamentoIA.jsx do Bate Lastro): descrever → testar num PDF de
 * exemplo → salvar. O salvar só libera depois de um teste bem-sucedido da mesma configuração.
 */
export function EditorTipo({ tipo, amostraInicial, onSalvo, onCancelar }: {
  tipo: TipoTreinado | null;
  amostraInicial?: OrigemAmostra;
  onSalvo: (t: TipoTreinado) => void;
  onCancelar: () => void;
}) {
  const ladoInicial = tipo?.slug.startsWith(PREFIXO.termo) ? 'termo' : 'lastro';
  const [lado, setLado] = useState<'termo' | 'lastro'>(ladoInicial);
  const [nome, setNome] = useState(tipo?.nome_exibicao ?? '');
  const [slugBase, setSlugBase] = useState(tipo ? tipo.slug.replace(/^termo_cessao_|^lastro_/, '') : '');
  const [slugTocado, setSlugTocado] = useState(Boolean(tipo));
  const [descricao, setDescricao] = useState(tipo?.descricao_identificacao ?? '');
  const [instrucoes, setInstrucoes] = useState(tipo?.instrucoes_gerais ?? '');
  const [campos, setCampos] = useState<Record<string, CampoSpec>>(() => ({ ...vazio(), ...(tipo?.campos ?? {}) }));
  const [multi, setMulti] = useState(tipo?.multi_recebiveis ?? false);
  const [instrucaoParcelas, setInstrucaoParcelas] = useState(tipo?.instrucao_parcelas ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [daFila, setDaFila] = useState<OrigemAmostra>(amostraInicial ?? null);
  const [resultado, setResultado] = useState<ResultadoTeste | null>(null);
  const [testadoCom, setTestadoCom] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'testar' | 'salvar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const abortar = useRef<AbortController | null>(null);

  const slug = PREFIXO[lado] + (slugTocado ? slugBase : slugDoNome(nome));
  const config: ConfigTipo = useMemo(() => {
    const usados = Object.fromEntries(Object.entries(campos)
      .filter(([c]) => multi || !CAMPOS_CANONICOS.find((x) => x.chave === c)?.soParcelas)
      .map(([c, s]) => [c, { ...s, instrucao: s.instrucao?.trim() || null, repete_por_linha: multi && lado === 'termo' ? s.repete_por_linha : false }]));
    return {
      slug, nome_exibicao: nome.trim(), descricao_identificacao: descricao.trim(), instrucoes_gerais: instrucoes.trim() || null,
      campos: usados, multi_recebiveis: multi, instrucao_parcelas: multi ? instrucaoParcelas.trim() || null : null,
    };
  }, [slug, nome, descricao, instrucoes, campos, multi, instrucaoParcelas, lado]);
  const chave = JSON.stringify(config);
  const testadoAgora = testadoCom === chave;
  const temAmostra = Boolean(arquivo || daFila || tipo?.tem_amostra);
  const presentes = Object.values(config.campos).filter((c) => c.presente).length;

  const mudarCampo = (chaveCampo: string, mudanca: Partial<CampoSpec>) => setCampos((c) => ({ ...c, [chaveCampo]: { ...c[chaveCampo], ...mudanca } }));

  const testar = async () => {
    setErro(null);
    setOcupado('testar');
    abortar.current = new AbortController();
    try {
      const r = await treinoApi.testar(config, { amostra: arquivo, documentoId: arquivo ? null : daFila?.documentoId, tipoId: !arquivo && !daFila ? tipo?.id : null }, abortar.current.signal);
      setResultado(r);
      setTestadoCom(chave);
    } catch (e) {
      if (!abortar.current?.signal.aborted) setErro(e instanceof ErroApi ? e.message : 'O teste não terminou.');
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async () => {
    setErro(null);
    setOcupado('salvar');
    try {
      const origem = { amostra: arquivo, documentoId: arquivo ? null : daFila?.documentoId ?? null };
      const r = tipo ? await treinoApi.atualizar(tipo.id, config, tipo.versao, origem) : await treinoApi.criar(config, origem);
      onSalvo(r.tipo);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar.');
    } finally {
      setOcupado(null);
    }
  };

  const camposVisiveis = CAMPOS_CANONICOS.filter((c) => multi || !c.soParcelas);
  const passo = (n: number, titulo: string, dica?: string) => (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--lastro-tinta)] font-display text-xs">{n}</span>
      <h3 className="font-display text-base tracking-tight">{titulo}</h3>
      {dica && <span className="text-xs text-slate-500">{dica}</span>}
    </div>
  );

  return (
    <div className="space-y-6">
      <section>
        {passo(1, 'Que documento é esse')}
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label>
            <span className="lastro-rotulo mb-1 block text-slate-500">Nome do tipo</span>
            <input className="lastro-campo h-10 w-full px-3 text-sm" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Contrato de Mútuo Rural" />
          </label>
          <div>
            <span className="lastro-rotulo mb-1 block text-slate-500">Ele comprova</span>
            <div className="flex gap-1.5">
              {(['lastro', 'termo'] as const).map((l) => (
                <button key={l} type="button" onClick={() => { setLado(l); if (l === 'lastro') setCampos((c) => Object.fromEntries(Object.entries(c).map(([k, s]) => [k, { ...s, repete_por_linha: false }]))); }}
                  className={cx('h-10 rounded-xl border-[1.5px] px-4 text-sm font-semibold', lado === l ? (l === 'termo' ? 'border-fuchsia-500 bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-200' : 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200') : 'border-slate-300 dark:border-slate-700')}>
                  {l === 'termo' ? 'Termo de cessão' : 'Lastro'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Identificador: <code className="font-mono">{slug}</code>
          {' · '}
          <button type="button" className="underline decoration-dotted" onClick={() => { setSlugTocado(true); setSlugBase(slugBase || slugDoNome(nome)); }}>editar</button>
          {slugTocado && <input className="lastro-campo ml-2 h-7 w-56 px-2 font-mono text-xs" value={slugBase} onChange={(e) => setSlugBase(slugDoNome(e.target.value) + (e.target.value.endsWith('_') ? '_' : ''))} />}
        </p>
      </section>

      <section>
        {passo(2, 'Como reconhecer', 'a IA usa esta descrição para separar este documento dos outros')}
        <textarea className="lastro-campo min-h-[96px] w-full resize-y px-3 py-2 text-sm" maxLength={4000} value={descricao} onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ex.: Contrato com o título 'CONTRATO DE MÚTUO RURAL', emitido por cooperativa, com quadro de parcelas e assinatura do produtor rural." />
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500">Instruções gerais (opcional)</summary>
          <textarea className="lastro-campo mt-2 min-h-[70px] w-full resize-y px-3 py-2 text-sm" maxLength={4000} value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)}
            placeholder="Ex.: O documento sempre tem duas vias; use a primeira." />
        </details>
      </section>

      <section>
        {passo(3, 'O que extrair', `${presentes} campo(s) marcado(s)`)}
        <label className="mb-3 flex w-fit items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          <span><b>Gera várias linhas</b> <span className="text-slate-500">— {lado === 'termo' ? 'o termo cede vários títulos' : 'o documento tem parcelas'}</span></span>
        </label>
        {multi && (
          <input className="lastro-campo mb-3 h-9 w-full px-3 text-sm" maxLength={2000} value={instrucaoParcelas} onChange={(e) => setInstrucaoParcelas(e.target.value)}
            placeholder={lado === 'termo' ? 'Como identificar os títulos cedidos (ex.: tabela "Relação de títulos", anexo I)' : 'Como identificar as parcelas (ex.: quadro "Cronograma de pagamento")'} />
        )}
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2">Campo</th><th className="px-2 py-2 text-center">No documento</th><th className="px-2 py-2 text-center">Obrigatório</th>
                {multi && <th className="px-2 py-2 text-center">{lado === 'termo' ? 'Muda por título' : 'Por parcela'}</th>}
                <th className="px-3 py-2">Onde achar (opcional)</th>
              </tr>
            </thead>
            <tbody>
              {camposVisiveis.map((c) => {
                const s = campos[c.chave];
                const repeteFixo = multi && lado === 'lastro' && (REPETE_LASTRO.includes(c.chave) || c.soParcelas);
                return (
                  <tr key={c.chave} className={cx('border-t border-slate-100 dark:border-slate-800', !s.presente && 'text-slate-400')}>
                    <td className="px-3 py-1.5"><span className="font-semibold" title={c.significado}>{c.rotulo}</span></td>
                    <td className="px-2 text-center"><input type="checkbox" checked={s.presente} onChange={(e) => mudarCampo(c.chave, { presente: e.target.checked })} aria-label={`${c.rotulo} está no documento`} /></td>
                    <td className="px-2 text-center"><input type="checkbox" disabled={!s.presente} checked={s.obrigatorio} onChange={(e) => mudarCampo(c.chave, { obrigatorio: e.target.checked })} aria-label={`${c.rotulo} obrigatório`} /></td>
                    {multi && (
                      <td className="px-2 text-center">
                        {lado === 'termo'
                          ? <input type="checkbox" disabled={!s.presente || Boolean(c.soParcelas)} checked={s.repete_por_linha} onChange={(e) => mudarCampo(c.chave, { repete_por_linha: e.target.checked })} aria-label={`${c.rotulo} muda por título`} />
                          : repeteFixo ? <span className="text-xs text-slate-500">sim</span> : <span className="text-xs text-slate-400">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      <input className="lastro-campo h-8 w-full min-w-[220px] px-2 text-xs" disabled={!s.presente} maxLength={2000} value={s.instrucao ?? ''} placeholder={c.exemplo}
                        onChange={(e) => mudarCampo(c.chave, { instrucao: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        {passo(4, 'Testar num PDF de exemplo', 'cada teste é uma leitura cobrada pelo Google')}
        <div className="flex flex-wrap items-center gap-3">
          <label className="lastro-botao lastro-botao-md lastro-botao-secundario cursor-pointer">
            <FileUp className="size-4" /> {arquivo ? 'Trocar PDF' : 'Escolher PDF'}
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </label>
          {arquivo ? <Etiqueta cor="sky">{arquivo.name} <button type="button" onClick={() => setArquivo(null)} aria-label="Tirar"><X className="size-3" /></button></Etiqueta>
            : daFila ? <Etiqueta cor="violet" titulo="Documento da fila de treino">{daFila.nome} <button type="button" onClick={() => setDaFila(null)} aria-label="Tirar"><X className="size-3" /></button></Etiqueta>
              : tipo?.tem_amostra ? <a className="text-xs underline decoration-dotted" href={treinoApi.urlAmostra(tipo.id)} target="_blank" rel="noreferrer">usar o exemplo salvo</a>
                : <span className="text-xs text-slate-500">Nenhum PDF escolhido.</span>}
          <Botao variante="primario" className="ml-auto" disabled={!temAmostra || !presentes || ocupado !== null || nome.trim().length < 3 || descricao.trim().length < 10} onClick={testar}
            title={!temAmostra ? 'Escolha um PDF de exemplo' : !presentes ? 'Marque ao menos um campo' : descricao.trim().length < 10 ? 'Descreva como reconhecer o documento' : ''}>
            {ocupado === 'testar' ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />} {ocupado === 'testar' ? 'Testando… pode levar até 2 min' : 'Testar extração'}
          </Botao>
          {ocupado === 'testar' && <Botao variante="fantasma" onClick={() => abortar.current?.abort()}>Cancelar teste</Botao>}
        </div>
        {resultado && (
          <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              {testadoAgora ? <Etiqueta cor="emerald"><CheckCircle2 className="size-3" /> testado com esta configuração</Etiqueta> : <Etiqueta cor="amber">a configuração mudou depois do teste — teste de novo</Etiqueta>}
              <span>{resultado.total_linhas} linha(s) extraída(s)</span>
              <span className="text-xs text-slate-500">{(resultado.tokens_entrada + resultado.tokens_saida).toLocaleString('pt-BR')} tokens{resultado.custo_usd !== null ? ` · US$ ${resultado.custo_usd.toFixed(4)}` : ''}</span>
            </p>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase text-slate-500 dark:bg-slate-900">
                  <tr>{Object.keys(resultado.linhas[0] ?? {}).map((k) => <th key={k} className="whitespace-nowrap px-2 py-1">{CAMPOS_CANONICOS.find((c) => c.chave === k)?.rotulo ?? k}</th>)}</tr>
                </thead>
                <tbody>
                  {resultado.linhas.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">{Object.values(l).map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{v === null || v === undefined ? <span className="text-slate-400">—</span> : String(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <span className="mr-auto text-xs text-slate-500">{testadoAgora ? 'Pronto para salvar: o próximo documento assim no Anexo já é lido com este tipo.' : 'O salvar libera depois de um teste bem-sucedido desta mesma configuração.'}</span>
        <Botao variante="fantasma" onClick={onCancelar}>Cancelar</Botao>
        <Botao variante="primario" disabled={!testadoAgora || ocupado !== null} onClick={salvar}>
          {ocupado === 'salvar' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {tipo ? 'Salvar alterações' : 'Salvar tipo'}
        </Botao>
      </div>
    </div>
  );
}
