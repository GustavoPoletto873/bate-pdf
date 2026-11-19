/**
 * Motor de pré-classificação do Bater PDF (porta do Bate Lastro, branch
 * feat/pre-classificacao-bater-pdf). Ver README.md desta pasta.
 *
 * `preClassificar(entrada)` faz o que carregar_e_pre_classificar faz no
 * Python, só que com os dados já em memória: páginas da base (sem os PDFs
 * acessórios, ordenadas por PDF e página), termos das outras bases do fundo,
 * aprendizado com os vínculos conferidos, 2ª passada pros lastros que só
 * existem noutra base do fundo e, no fim, "não achado" vira D sem valor.
 */
import { CatalogoGlobal, carregarCatalogo } from './layout';
import {
  MAX_LASTROS_EXTERNOS, type InfoPdfExterno, type Obj, type OrigemCampo, Pagina, aprendizadoDaBase, documentosSemLastro,
  ehTermoCessao, naoEncontradoViraD, preClassificarNucleo, semLastro,
} from './motor';
import { type RegrasFundo } from './perfis';
import { compararStr, search, re, S } from './py';

export { normalizarTexto } from './valores';
export {
  termosDeBusca, termoIsoladoEm, formasDeBusca, formaDoCampo, FORMAS, FORMAS_NUMERICAS, extrairDatas, extrairMoedas,
  extrairPessoas, extrairNumeros, extrairCodigos, formatarPessoa,
} from './formas';
export { regrasDoFundo, regrasDoFundoDaAmostra, assinaturaDaAmostra, familiaRecebivel, perfilDe, PERFIS, CONVENCOES } from './perfis';
export type { RegrasFundo, AssinaturaAmostra } from './perfis';
export { AprendizadoLayout, CatalogoGlobal, montarCatalogo, carregarCatalogo } from './layout';
export type { Convencao, DadosCatalogo } from './layout';
export {
  Pagina, Amostra, IndiceBase, preClassificarNucleo, naoEncontradoViraD, aprendizadoDaBase, vereditosPelaLeitura,
  chavesDocumento, numeroConfere, normalizarData, normalizarMoeda, normalizarPessoa, ehTermoCessao, ehTermoMatch,
  CAMPOS_LASTRO, CAMPOS_TERMO_EXTRA,
} from './motor';
export type { Obj, OrigemCampo, InfoPdfExterno, Evidencia } from './motor';
export { colunasDeVencimento, completarVencimento } from './vencimento';

/** Uma pendência em aberto — as colunas de _SQL_PENDENCIAS (uma linha por título e lado). */
export type RegistroPendencia = {
  unmatch_id?: number | string | null;
  registro_base_id: number | string;
  registro_leitura_id?: number | null;
  /** 'termo_cessao' (ou qualquer tipo que comece com isso) é termo; o resto é lastro. */
  tipo_documento: string;
  base_tipo_recebivel?: string | null;
  base_numero_documento?: string | number | null;
  base_sacado_nome?: string | null;
  base_sacado_documento?: string | null;
  base_cedente_nome?: string | null;
  base_cedente_documento?: string | null;
  /** Decimal com ponto ("1613.33") ou número. */
  base_valor_total?: string | number | null;
  /** 'AAAA-MM-DD'. */
  base_data_emissao?: string | null;
  base_data_vencimento?: string | null;
  base_data_aquisicao?: string | null;
  base_nome_fundo?: string | null;
  base_cnpj_fundo?: string | null;
  [extra: string]: unknown;
};

/** Texto de uma página, já normalizado (normalizarTexto do texto extraído pelo PDFium). */
export type PaginaTexto = { pdf: string; pagina: number; texto_normalizado: string };

/** Vínculo já conferido (linha de _SQL_VINCULOS_CONFERIDOS): a amostra, a leitura e o veredito do time. */
export type VinculoConferido = Omit<RegistroPendencia, 'tipo_documento'> & {
  tipo_documento: string;
  processed_pdf: string;
  /** {campo: 'V'|'D'|'P'} (objeto ou JSON). Sem ele, vale V onde a leitura é igual à amostra. */
  marcacoes_campos?: Record<string, string> | string | null;
  leitura_numero_documento?: unknown;
  leitura_sacado_nome?: unknown;
  leitura_sacado_documento?: unknown;
  leitura_cedente_nome?: unknown;
  leitura_cedente_documento?: unknown;
  leitura_valor_total?: unknown;
  leitura_data_emissao?: unknown;
  leitura_data_vencimento?: unknown;
  leitura_data_aquisicao?: unknown;
  leitura_nome_cessionario?: unknown;
  leitura_doc_cessionario?: unknown;
};

/** O que a IA leu de um PDF (CPF/CNPJ do sacado e valor) — cobre o PDF sem texto. */
export type LeituraIa = { pdf: string; documento: string | null; valor: string | number | null };

export type EntradaPreClassificacao = {
  /** As pendências da base (uma linha por título e lado em aberto). */
  pendencias: RegistroPendencia[];
  /** Páginas dos PDFs da base. */
  paginas: PaginaTexto[];
  /** {pdf: true se é termo} — vem das leituras de IA; PDF fora daqui é decidido pelo texto. */
  tiposPdf?: Record<string, boolean>;
  /** PDFs com leitura de IA disponível (desempata cópias). */
  pdfsComLeitura?: string[];
  /** PDFs com alguma leitura de lastro (o que tem leitura de termo E de lastro serve aos dois). */
  pdfsComLastro?: string[];
  /** Procedência das datas da amostra (amostra_origem_campo). */
  origens?: OrigemCampo[];
  /** Termos de outras bases do fundo já escolhidos por quem chama (alternativa a `outrasBases`). */
  paginasExternas?: PaginaTexto[];
  pdfsExternos?: Record<string, InfoPdfExterno>;
  /** Leituras de IA desta base e das outras do fundo. */
  leituras?: LeituraIa[];
  /** Regras da administradora (ver regrasDoFundo / regrasDoFundoDaAmostra). */
  regrasFundo?: RegrasFundo;
  /** Vínculos já conferidos (desta base e das outras do fundo) — fonte do aprendizado por layout. */
  vinculos?: VinculoConferido[];
  /** Páginas dos PDFs dos vínculos que não estão em `paginas` nem nas externas. */
  paginasAprendizado?: PaginaTexto[];
  /** Catálogo entre fundos (JSON gerado por montarCatalogo), opcional. */
  catalogo?: unknown;
  /**
   * Todas as páginas das OUTRAS bases do mesmo fundo. Com elas o motor escolhe
   * sozinho os termos dessas bases (como _SQL_TERMOS_DO_FUNDO) e faz a 2ª
   * passada dos lastros (como _carregar_lastros_do_fundo).
   */
  outrasBases?: {
    paginas: (PaginaTexto & { base_id: string })[];
    /** {base_id: "FUNDO — ref. 2026-09-30"}. */
    rotulos?: Record<string, string>;
    /** {pdf: TIPO_RECEBIVEL de alguma leitura} das outras bases (termo pela leitura). */
    tiposLeitura?: Record<string, string>;
  };
};

export type StatusCampo = {
  valor: 'V' | 'D' | 'P';
  encontrado: string | null;
  evidencias?: unknown[];
  regra?: string | null;
  origem?: string | null;
  fonte?: Obj | null;
  alerta?: Obj;
  sem_confirmacao?: 'outro_documento' | 'sem_documento' | 'time_dividido';
  [k: string]: unknown;
};

export type Candidato = {
  processed_pdf: string;
  pagina: number;
  score: number;
  trecho: string;
  tem_leitura: boolean;
  confianca: string;
  alternativas: Obj[];
  regiao: [number, number, number] | null;
  evidencias: unknown[][];
  aviso?: string | null;
  base_externa?: InfoPdfExterno | null;
  regra?: string | null;
};

export type ResultadoPendencia = {
  registro_base_id: number | string;
  confianca: 'alta' | 'media' | 'baixa' | 'ambigua' | 'sem_candidato';
  candidatos: Record<string, Candidato>;
  campos: Record<string, StatusCampo>;
  registros: RegistroPendencia[];
};

export type ResultadoPreClassificacao = {
  total: number;
  resumo: Record<string, number>;
  pdfs_analisados: number;
  paginas_analisadas: number;
  regras_fundo: RegrasFundo;
  resultados: ResultadoPendencia[];
};

const RE_DOCUMENTO_ACESSORIO = re(`dados${S}+do${S}+segurado|bilhete${S}+(?:de${S}+seguro|numero)`);
const PALAVRAS_TERMO_EXTERNO = ['termo de cessao', 'termo de endosso'];
const CAPA_DE_TERMO = ['termo de cessao', 'instrumento particular de cessao', 'termo de endosso'];

function paginas(lista: PaginaTexto[] | undefined): Pagina[] {
  return (lista ?? []).map((p) => Pagina.deTexto(p.pdf, p.pagina, p.texto_normalizado));
}

/** Páginas da base como o Python as carrega: sem os PDFs acessórios (pela pág. 1), ordenadas por (pdf, página). */
export function paginasDaBase(lista: PaginaTexto[]): Pagina[] {
  const primeira = new Map<string, string>();
  for (const p of lista) if (p.pagina === 1 && !primeira.has(p.pdf)) primeira.set(p.pdf, p.texto_normalizado || '');
  const acessorio = (pdf: string) => search(RE_DOCUMENTO_ACESSORIO, [...(primeira.get(pdf) ?? '')].slice(0, 400).join('')) !== null;
  const mantidas = lista.filter((p) => !acessorio(p.pdf));
  mantidas.sort((a, b) => compararStr(a.pdf, b.pdf) || a.pagina - b.pagina);
  return paginas(mantidas);
}

function rotuloDaBase(rotulos: Record<string, string> | undefined, base: string): string {
  return rotulos?.[base] ?? base;
}

/** Termos das outras bases do fundo: PDF com leitura de termo, ou cujo começo diz "termo de cessão/endosso". */
function termosDoFundo(outras: NonNullable<EntradaPreClassificacao['outrasBases']>, pdfsDaBase: Set<string>) {
  const termos = new Set<string>();
  for (const [pdf, tipo] of Object.entries(outras.tiposLeitura ?? {})) if (ehTermoCessao(tipo)) termos.add(pdf);
  for (const p of outras.paginas) {
    if (p.pagina <= 3 && PALAVRAS_TERMO_EXTERNO.some((t) => (p.texto_normalizado || '').includes(t))) termos.add(p.pdf);
  }
  const linhas: PaginaTexto[] = [];
  const info: Record<string, InfoPdfExterno> = {};
  for (const p of outras.paginas) {
    if (!termos.has(p.pdf) || pdfsDaBase.has(p.pdf)) continue;
    linhas.push(p);
    if (!(p.pdf in info)) info[p.pdf] = { base_id: p.base_id, rotulo: rotuloDaBase(outras.rotulos, p.base_id) };
  }
  return { linhas, info };
}

/** 2ª passada: lastros de outras bases do fundo que trazem o CPF/CNPJ do sacado das pendências sem lastro. */
function lastrosDoFundo(outras: NonNullable<EntradaPreClassificacao['outrasBases']>, resultados: Obj[], jaCarregados: Set<string>) {
  const padroes = documentosSemLastro(resultados);
  if (!outras.paginas.length || !padroes.length || padroes.length > 2 * MAX_LASTROS_EXTERNOS) return { linhas: [] as PaginaTexto[], info: {} as Record<string, InfoPdfExterno> };
  const achados = new Set<string>();
  for (const p of outras.paginas) {
    if (jaCarregados.has(p.pdf)) continue;
    if (padroes.some((d) => (p.texto_normalizado || '').includes(d))) achados.add(p.pdf);
  }
  const linhas = outras.paginas.filter((p) => achados.has(p.pdf));
  const info: Record<string, InfoPdfExterno> = {};
  for (const p of linhas) if (!(p.pdf in info)) info[p.pdf] = { base_id: p.base_id, rotulo: rotuloDaBase(outras.rotulos, p.base_id), tipo: 'lastro' };
  for (const pdf of Object.keys(info)) {
    const inicio = linhas.filter((p) => p.pdf === pdf).sort((a, b) => a.pagina - b.pagina).slice(0, 3)
      .map((p) => p.texto_normalizado || '').join(' ');
    if (CAPA_DE_TERMO.some((t) => inicio.includes(t))) delete info[pdf];
  }
  return { linhas: linhas.filter((p) => p.pdf in info), info };
}

/** Pré-classifica todas as pendências (sugestão; nada é gravado). */
export function preClassificar(entrada: EntradaPreClassificacao): ResultadoPreClassificacao {
  if (!entrada.pendencias.length) return naoEncontradoViraD(preClassificarNucleo([], [])) as ResultadoPreClassificacao;
  const base = paginasDaBase(entrada.paginas);
  const pdfsDaBase = new Set(base.map((pg) => pg.pdf));
  let externasTexto = entrada.paginasExternas ?? [];
  let pdfsExternos: Record<string, InfoPdfExterno> = { ...(entrada.pdfsExternos ?? {}) };
  if (entrada.outrasBases && !entrada.paginasExternas) {
    const termos = termosDoFundo(entrada.outrasBases, pdfsDaBase);
    externasTexto = termos.linhas;
    pdfsExternos = { ...termos.info, ...pdfsExternos };
  }
  const externas = paginas(externasTexto);
  const catalogo: CatalogoGlobal | null = entrada.catalogo instanceof CatalogoGlobal ? entrada.catalogo : carregarCatalogo(entrada.catalogo);
  const aprendizado = aprendizadoDaBase((entrada.vinculos ?? []) as Obj[], [...base, ...externas, ...paginas(entrada.paginasAprendizado)], catalogo);
  const opcoes = {
    tiposPdf: entrada.tiposPdf ?? {},
    pdfsComLeitura: entrada.pdfsComLeitura ?? [],
    origens: entrada.origens ?? [],
    leituras: entrada.leituras ?? [],
    regrasFundo: entrada.regrasFundo ?? {},
    aprendizado,
    pdfsComLastro: entrada.pdfsComLastro ?? [],
  };
  const resultado = preClassificarNucleo(entrada.pendencias as Obj[], base, { ...opcoes, paginasExternas: externas, pdfsExternos });
  if (entrada.outrasBases) {
    const jaCarregados = new Set([...pdfsDaBase, ...Object.keys(pdfsExternos)]);
    const lastros = lastrosDoFundo(entrada.outrasBases, resultado.resultados, jaCarregados);
    if (Object.keys(lastros.info).length) {
      const ids = new Set(resultado.resultados.filter(semLastro).map((r: Obj) => r.registro_base_id));
      const refeitos = preClassificarNucleo(
        entrada.pendencias.filter((p) => ids.has(p.registro_base_id)) as Obj[], base,
        { ...opcoes, paginasExternas: [...externas, ...paginas(lastros.linhas)], pdfsExternos: { ...pdfsExternos, ...lastros.info } },
      );
      const porId = new Map(refeitos.resultados.map((r: Obj) => [r.registro_base_id, r]));
      resultado.resultados = resultado.resultados.map((r: Obj) => porId.get(r.registro_base_id) ?? r);
      resultado.resumo = { alta: 0, media: 0, baixa: 0, ambigua: 0, sem_candidato: 0 };
      for (const r of resultado.resultados) resultado.resumo[r.confianca] += 1;
      resultado.pdfs_analisados += Object.keys(lastros.info).length;
    }
  }
  return naoEncontradoViraD(resultado) as ResultadoPreClassificacao;
}
