/**
 * Porta de frontend/src/components/BaterPdfModal/preClassificacao.js do Bate
 * Lastro (branch feat/pre-classificacao-bater-pdf): rótulos, motivo e grupo da
 * conferência, recortes e planejamento de gravação/vínculo. Puro (sem React).
 *
 * Diferença de modelo: aqui as marcações são por pendência (título × lado). A
 * sugestão do motor é por título (`registro_base_id` = id do título); ao
 * aplicar, cada lado pendente recebe os campos dele (Lastro: os 8 comuns).
 */
import { camposDoLado, CAMPO_POR_ID, type CampoId, type Lado, type Veredito } from '@/lib/campos';
import type { SugestaoTitulo, StatusCampoSugerido, CandidatoSugerido } from '@/lib/cliente';
import type { PendenciaLinha, OperacaoMarcacao } from '@/lib/repo';

export const CONFIANCAS_APLICAVEIS = new Set(['alta', 'media']);

export const ROTULO_CONFIANCA: Record<string, { texto: string; cor: 'emerald' | 'sky' | 'amber' | 'orange' | 'rose'; ponto: string }> = {
  alta: { texto: 'Alta', cor: 'emerald', ponto: 'bg-emerald-500' },
  media: { texto: 'Média', cor: 'sky', ponto: 'bg-sky-500' },
  baixa: { texto: 'Baixa', cor: 'amber', ponto: 'bg-amber-500' },
  ambigua: { texto: 'Ambígua', cor: 'orange', ponto: 'bg-orange-500' },
  sem_candidato: { texto: 'Não identificado', cor: 'rose', ponto: 'bg-rose-500' },
};

// Veredito que não veio de igualdade literal: a tela diz qual regra decidiu.
export const ROTULO_REGRA: Record<string, string> = {
  ccb_sem_numero: 'CCB Digital não tem número',
  cronograma_parcelas: 'Parcela dentro do cronograma da CCB',
  planilha_sem_vencimento: 'Planilha sem vencimento; preencher com o do PDF',
  ausente_no_documento: 'Documento não traz esse valor',
  vencimento_um_dia_antes: 'Documento traz 1 dia antes; o time mantém a data da amostra',
  data_assinatura: 'Data da assinatura (última página)',
  aquisicao_igual_emissao: 'Aquisição = emissão do documento de emissão (CCB)',
  vale_documento_emissao: 'Vale a data do documento de emissão (CCB)',
  planilha_vazia_vale_documento: 'Amostra vazia; preencher com a do documento',
  amostra_outra_coluna: 'Coluna vazia na amostra; vale a outra coluna da amostra',
  data_so_na_amostra: 'Documento não traz a data; vale a da amostra',
  cnpj_mesma_raiz: 'Mesma empresa (raiz do CNPJ), outra filial: o time confere V',
  nome_parcial_com_cpf: 'Metade ou mais do nome ao lado do CPF do sacado (abreviado ou truncado): o time confere V',
  cessionario_pelo_cnpj: 'CNPJ do fundo confere; o termo traz o fundo com outro nome (fundo renomeado): o time confere V',
  planilha_um_dia_depois: 'Planilha 1 dia depois do documento: na emissão o time mantém a amostra; no vencimento (ajuste de fim de semana) vale a do documento',
  nao_consta_no_documento: 'Este tipo de documento não traz o campo; o time confere V (padrão do histórico)',
  emissao_sem_valor: 'Emissão não está na amostra nem nos documentos: D sem valor no documento',
  valor_pela_amostra: 'QI TECH: vale o valor nominal da amostra (usado como valor de aquisição), mesmo fora do documento',
  termo_pela_amostra: 'Termo não encontrado: vale o que está na amostra',
  convencao_do_layout: 'Aprendido com o time: neste modelo de documento, nesse papel (termo/lastro), o time marca assim',
  convencao_de_outros_fundos: 'Aprendido em outros fundos (catálogo local): neste modelo de documento, o time marca assim',
  documento_do_lote: 'Documento do lote: não traz o título, mas tem o cedente e o fundo — o time usa esse modelo para vários títulos',
  cessionario_outro_cnpj: 'O termo cede para outro CNPJ (não o fundo da amostra)',
  nao_enviado_pela_administradora: 'A administradora do fundo não manda essa coluna: vem validada pela regra dela (ex.: emissão na QI TECH)',
  documento_do_lote_confirmado: 'Termo do lote: o time já vinculou a este PDF vários títulos com a mesma aquisição e o mesmo cedente',
  nao_encontrado: 'Não achado nos documentos do título: D sem valor no documento (P fica pro analista)',
  numero_com_parcela: 'O nº da amostra e o do documento são o mesmo, com prefixo ou parcela a mais em um deles',
  valor_na_leitura_ia: 'Valor achado na leitura da IA de um PDF do mesmo devedor',
  ccb_como_termo: 'CCB com cláusula de cessão/endosso ao fundo servindo de termo',
};

export const ROTULO_AVISO: Record<string, string> = {
  so_a_pessoa: 'O documento só traz a pessoa (CPF/nome), não o título',
  cpf_de_outra_pessoa: 'O documento traz o CPF de outra pessoa',
  parcela_fora_do_indice: 'A parcela não está no texto indexado',
};

export const candidatoPrincipal = (s?: SugestaoTitulo | null): CandidatoSugerido | null =>
  (s?.candidatos?.lastro as CandidatoSugerido) || (s?.candidatos?.termo as CandidatoSugerido) || null;

/** Documento sugerido para um lado da pendência. */
export const candidatoDoLado = (s: SugestaoTitulo | undefined, lado: Lado): CandidatoSugerido | null =>
  (s?.candidatos?.[lado] as CandidatoSugerido) ?? null;

type MotivoSemConfirmacao = { chave: 'sem_documento' | 'time_dividido' | 'outro_documento'; texto: string };
const REGRAS_V_SEM_DOCUMENTO = new Set(['nao_consta_no_documento', 'data_so_na_amostra', 'termo_pela_amostra']);

export const motivoSemConfirmacao = (status?: StatusCampoSugerido | null): MotivoSemConfirmacao | null => {
  const motivo = status?.sem_confirmacao;
  if (!motivo) return null;
  if (motivo === 'sem_documento' || (motivo === true && REGRAS_V_SEM_DOCUMENTO.has(String(status?.regra)))) {
    return { chave: 'sem_documento', texto: 'nenhum documento do título traz o valor — o V vem da amostra' };
  }
  if (motivo === 'time_dividido') {
    return { chave: 'time_dividido', texto: 'achado no documento, mas neste layout o time do fundo marca dos dois jeitos' };
  }
  return {
    chave: 'outro_documento',
    texto: status?.origem === 'referencia' ? 'está na CCB (documento de emissão), não no termo' : 'aparece em outro documento do título, não no sugerido',
  };
};

const rotulos = (campos: string[]) => campos.map((c) => CAMPO_POR_ID[c as CampoId]?.rotulo ?? c).join(', ');
const ROTULO_CONFIANCA_TEXTO: Record<string, string> = { media: 'média', baixa: 'baixa', ambigua: 'ambígua', sem_candidato: 'sem candidato' };

export type Motivo = { chave: string; decisao: 'confirmar' | 'revisar' | 'pendente' | 'decidir'; titulo: string; explicacao: string };

type Alerta = { informativo?: boolean; [k: string]: unknown } | null | undefined;
const alertaDecisivo = (st?: StatusCampoSugerido) => Boolean(st?.alerta) && !(st?.alerta as Alerta)?.informativo;

/** Por que a sugestão pede (ou não) olho — mesmo motivo, mesma decisão para o grupo inteiro. */
export const motivoDaConferencia = (sugestao: SugestaoTitulo): Motivo => {
  const campos = Object.entries(sugestao?.campos || {});
  const candidatos = Object.values(sugestao?.candidatos || {}) as CandidatoSugerido[];
  const aviso = candidatos.find((c) => c?.aviso)?.aviso as string | undefined;
  if (aviso === 'so_a_pessoa' || aviso === 'cpf_de_outra_pessoa') {
    return {
      chave: `aviso:${aviso}`, decisao: 'pendente',
      titulo: aviso === 'so_a_pessoa' ? 'O lastro sugerido só traz a pessoa (CPF/nome), não o título' : 'O lastro sugerido traz o CPF de outra pessoa',
      explicacao: 'Não é a CCB deste título (dossiê, consulta ou outro contrato). Deixe pendente até a CCB certa chegar.',
    };
  }
  if (candidatos.some((c) => c?.base_externa)) {
    return { chave: 'termo_outra_base', decisao: 'revisar', titulo: 'Termo achado em outra base do mesmo fundo', explicacao: 'Confira se é o mesmo termo antes de vincular.' };
  }
  if (aviso) {
    return { chave: `aviso:${aviso}`, decisao: 'revisar', titulo: 'Documento com aviso', explicacao: 'Veja o aviso no cartão antes de vincular.' };
  }
  if (sugestao?.confianca !== 'alta') {
    const c = sugestao?.confianca || 'baixa';
    return {
      chave: `confianca:${c}`, decisao: 'revisar', titulo: `Confiança ${ROTULO_CONFIANCA_TEXTO[c] || c} no documento sugerido`,
      explicacao: 'O documento sugerido pode não ser o do título. Confira os exemplos; se não for, deixe o grupo pendente.',
    };
  }
  const partes: Motivo[] = [];
  const comAlerta = campos.filter(([, st]) => alertaDecisivo(st)).map(([c]) => c);
  if (comAlerta.length) {
    partes.push({
      chave: `alerta:${comAlerta.join(',')}`, decisao: 'confirmar', titulo: `o documento traz outra ${rotulos(comAlerta)}`,
      explicacao: 'Fica V pela data da amostra (a do documento aparece no cartão); no histórico, o time manteve a data da amostra em 86% das aquisições.',
    });
  }
  const semConf = campos.filter(([, st]) => st?.sem_confirmacao);
  if (semConf.length) {
    const porMotivo: Record<string, string[]> = { outro_documento: [], sem_documento: [], time_dividido: [] };
    semConf.forEach(([c, st]) => porMotivo[motivoSemConfirmacao(st)!.chave].push(c));
    const titulos = [
      porMotivo.outro_documento.length && `${rotulos(porMotivo.outro_documento)} só em outro documento do título (não no termo)`,
      porMotivo.sem_documento.length && `${rotulos(porMotivo.sem_documento)}: nenhum documento traz — V pela amostra`,
      porMotivo.time_dividido.length && `${rotulos(porMotivo.time_dividido)}: o time do fundo marca dos dois jeitos`,
    ].filter(Boolean);
    const explicacoes = [
      porMotivo.outro_documento.length && 'Quando o valor estava só no outro documento, o time marcou V em 82% no histórico geral.',
      porMotivo.sem_documento.length && `Nenhum PDF do título traz ${rotulos(porMotivo.sem_documento)}: o V é da amostra, sem prova no documento.`,
      porMotivo.time_dividido.length && 'Neste layout o time do fundo já marcou V e D.',
    ].filter(Boolean);
    partes.push({
      chave: `sem_conf:${semConf.map(([c]) => c).join(',')}`, decisao: 'confirmar',
      titulo: titulos.join(' + '),
      explicacao: `O fundo ainda não tem títulos conferidos mostrando como o time marca isso. ${explicacoes.join(' ')} Confirmar grava V.`,
    });
  }
  const outroCnpj = campos.find(([c, st]) => c === 'doc_cessionario' && st?.regra === 'cessionario_outro_cnpj');
  if (outroCnpj) {
    partes.push({
      chave: `cessionario:${outroCnpj[1].encontrado}`, decisao: 'decidir',
      titulo: `o termo cede para o CNPJ ${outroCnpj[1].encontrado}, não para o fundo da amostra`,
      explicacao: `Se ${outroCnpj[1].encontrado} for deste fundo (outro CNPJ ou fundo incorporado), confirme: grava o cessionário como D com o CNPJ do termo e vincula. Se não for, o título não é deste fundo: deixe pendente.`,
    });
  }
  const naoAchados = campos
    .filter(([c, st]) => (st?.valor === 'P' || st?.regra === 'nao_encontrado') && !(outroCnpj && c === 'nome_cessionario'))
    .map(([c]) => c);
  if (naoAchados.length) {
    const outroFundo = naoAchados.includes('doc_cessionario') && naoAchados.includes('nome_cessionario');
    partes.push({
      chave: `nao_encontrado:${naoAchados.join(',')}`, decisao: outroFundo ? 'revisar' : 'confirmar',
      titulo: outroFundo ? 'o termo não traz este fundo como cessionário' : `${rotulos(naoAchados)} não achado`,
      explicacao: outroFundo
        ? 'O termo pode ser de cessão a outro fundo: confira no recorte quem é o cessionário antes de vincular.'
        : `Confirmar grava ${rotulos(naoAchados)} como D (sem valor no documento).`,
    });
  }
  const divergentes = campos.filter(([, st]) => st?.valor === 'D' && st.encontrado && !st.regra).map(([c]) => c);
  if (divergentes.length) {
    partes.push({
      chave: `divergente:${divergentes.join(',')}`, decisao: 'revisar', titulo: `o documento traz outro ${rotulos(divergentes)}`,
      explicacao: 'Sem regra que explique a diferença: confira os exemplos.',
    });
  }
  const corrigidos = campos
    .filter(([, st]) => st?.valor === 'D' && st.encontrado && st.regra && st.regra !== 'cessionario_outro_cnpj')
    .map(([c]) => c);
  if (corrigidos.length) {
    partes.push({
      chave: `correcao:${corrigidos.join(',')}`, decisao: 'confirmar', titulo: `correção sugerida em ${rotulos(corrigidos)}`,
      explicacao: 'Confirmar grava a correção (D com o valor do documento).',
    });
  }
  if (!partes.length) {
    return { chave: 'confere', decisao: 'confirmar', titulo: 'Tudo confere com o documento', explicacao: 'Confirmar grava as marcações e vincula.' };
  }
  const titulo = partes.map((pt) => pt.titulo).join(' + ');
  return {
    chave: partes.map((pt) => pt.chave).join('|'),
    decisao: (['revisar', 'decidir', 'confirmar'] as const).find((d) => partes.some((pt) => pt.decisao === d))!,
    titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1),
    explicacao: `${partes.map((pt) => pt.explicacao).join(' ')} Confirmar o grupo grava as sugestões e vincula.`,
  };
};

export type Grupo = { motivo: Motivo; itens: SugestaoTitulo[] };

/** Sugestões por motivo, o grupo maior primeiro. */
export const agruparPorMotivo = (lista: SugestaoTitulo[]): Grupo[] => {
  const grupos = new Map<string, Grupo>();
  for (const s of lista) {
    const motivo = motivoDaConferencia(s);
    if (!grupos.has(motivo.chave)) grupos.set(motivo.chave, { motivo, itens: [] });
    grupos.get(motivo.chave)!.itens.push(s);
  }
  return [...grupos.values()].sort((a, b) => b.itens.length - a.itens.length);
};

/** 'sozinho' (confere), 'correcao', 'diverge' (data contradiz) ou 'olho'. */
export const grupoDaConferencia = (s: SugestaoTitulo): 'sozinho' | 'correcao' | 'diverge' | 'olho' => {
  if (s?.confianca !== 'alta') return 'olho';
  if (Object.values(s.campos || {}).some((st) => alertaDecisivo(st))) return 'diverge';
  if ((Object.values(s.candidatos || {}) as CandidatoSugerido[]).some((c) => c?.aviso || c?.base_externa)) return 'olho';
  const campos = Object.values(s.campos || {});
  if (campos.some((st) => st.valor === 'P' || st.regra === 'nao_encontrado' || st.sem_confirmacao || (st.valor === 'D' && st.encontrado && !st.regra))) return 'olho';
  if (campos.some((st) => st.valor === 'D' && st.encontrado)) return 'correcao';
  return 'sozinho';
};

export type Recorte = { pdf: string; pagina: number; trechos: string; regiao: string };

/** Recortes do PDF de um candidato: um por página com evidência, a página do título primeiro. */
export const recortesDoCandidato = (candidato?: CandidatoSugerido | null): Recorte[] => {
  if (!candidato) return [];
  const porPagina = new Map<number, Set<string>>();
  const daPagina = (p: number) => {
    if (!porPagina.has(p)) porPagina.set(p, new Set());
    return porPagina.get(p)!;
  };
  const regiao = candidato.regiao as [number, number, number] | null | undefined;
  if (regiao) daPagina(regiao[0]);
  for (const [valor, pagina, inicio, fim] of (candidato.evidencias as [string, number, number, number][] | undefined) || []) {
    daPagina(pagina).add(`${valor}:${inicio}-${fim}`);
  }
  const paginaTitulo = regiao?.[0] ?? (candidato.pagina as number);
  return [...porPagina.entries()]
    .sort(([a], [b]) => (a === paginaTitulo ? -1 : b === paginaTitulo ? 1 : a - b))
    .map(([pagina, trechos]) => ({
      pdf: String(candidato.processed_pdf),
      pagina,
      trechos: [...trechos].join(','),
      regiao: regiao?.[0] === pagina ? `${regiao[1]}-${regiao[2]}` : '',
    }));
};

/** Texto de onde veio uma data: "Amostra — coluna X (motivo)" ou "Vencimento — arquivo.pdf, pág. 1". */
export const formatarFonte = (fonte: Record<string, unknown> | null | undefined, nomes: Record<string, string> = {}) => {
  if (!fonte) return '';
  if (fonte.tipo === 'amostra') {
    const base = fonte.coluna ? `Amostra — coluna ${fonte.coluna}` : 'Amostra';
    return fonte.motivo ? `${base} (${fonte.motivo})` : base;
  }
  const arquivo = nomes[String(fonte.arquivo)] ?? String(fonte.arquivo ?? '');
  const onde = `${arquivo}${fonte.pagina ? `, pág. ${fonte.pagina}` : ''}`;
  return fonte.rotulo ? `${fonte.rotulo} — ${onde}` : onde;
};

// ---------------------------------------------------------------------------
// Planejamento (no modelo por pendência deste app)
// ---------------------------------------------------------------------------

type MarcasDaPendencia = Partial<Record<CampoId, { valor: Veredito; valor_digitado: string | null }>>;

/**
 * Operações para gravar a sugestão do título nos lados pendentes. Só V e D (P
 * é "não decidi"). Nunca pisa em marcação manual já feita, salvo `sobrescrever`.
 */
export const planejarMarcacoesSugeridas = (
  sugestao: SugestaoTitulo,
  pendencias: PendenciaLinha[],
  { sobrescrever = false }: { sobrescrever?: boolean } = {},
): OperacaoMarcacao[] => {
  const ops: OperacaoMarcacao[] = [];
  for (const p of pendencias) {
    if (p.titulo_id !== sugestao.registro_base_id || p.situacao !== 'pendente') continue;
    const ja: MarcasDaPendencia = p.marcacoes;
    for (const def of camposDoLado(p.lado)) {
      const st = sugestao.campos?.[def.campo];
      if (!st || (st.valor !== 'V' && st.valor !== 'D')) continue;
      if (!sobrescrever && ja[def.campo]) continue;
      ops.push({
        pendencia_id: p.pendencia_id, campo: def.campo, valor: st.valor,
        valor_digitado: st.valor === 'D' ? (st.encontrado ?? '') : null, origem: 'pre_classificacao',
      });
    }
  }
  return ops;
};

/** "Deixar pendente": P em todos os campos ainda não decididos (V/D manuais ficam, salvo `sobrescrever`). */
export const planejarMarcacoesPendentes = (pendencias: PendenciaLinha[], { sobrescrever = false } = {}): OperacaoMarcacao[] =>
  pendencias.filter((p) => p.situacao === 'pendente').flatMap((p) => camposDoLado(p.lado)
    .filter((def) => p.marcacoes[def.campo]?.valor !== 'P' && (sobrescrever || !p.marcacoes[def.campo]))
    .map((def) => ({ pendencia_id: p.pendencia_id, campo: def.campo, valor: 'P' as Veredito, valor_digitado: null, origem: 'manual' })));

/** O título foi "deixado pendente" inteiro (todos os campos P)? */
export const deixadoPendente = (p: PendenciaLinha) =>
  camposDoLado(p.lado).every((def) => p.marcacoes[def.campo]?.valor === 'P');
