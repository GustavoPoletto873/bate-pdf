/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pré-classificação automática das pendências do Bater PDF — tradução linha a
 * linha de backend/services/pre_classificacao_service.py (Bate Lastro, branch
 * feat/pre-classificacao-bater-pdf). Só a parte pura: sem banco, sem cache.
 *
 * Como decide:
 * 1. Cada página vira uma lista de valores normalizados (datas, moedas,
 *    CPF/CNPJ, números de documento, códigos), com a posição de cada um.
 * 2. Pra cada pendência, as ocorrências do nº do documento (ou valor/doc. do
 *    sacado) viram ÂNCORAS, avaliadas na página inteira e na linha.
 * 3. A região com mais campos batendo vence; a diferença pra segunda decide a
 *    confiança.
 *
 * O resultado é só SUGESTÃO: quem grava V/D é a tela, por clique explícito.
 *
 * Os objetos de saída usam as mesmas chaves (snake_case) e formas do Python,
 * porque a tela (preClassificacao.js / ConferenciaPreClassificacao.jsx) lê
 * esse formato. Onde o Python faz `dict.get(chave)` e põe o resultado na
 * saída, aqui vai `?? null` (JSON `null`, não chave ausente).
 */
import {
  B, Contador, D, S, NS, WS, bisectLeft, bisectRight, compararStr, compararTuplas, escapar, finditer, inteiro,
  lstrip, matchEm, ordenar, re, search, split, strip, zfill,
} from './py';
import {
  MESES, RE_DATA_EXTENSO_Y, RE_DIGITOS, RE_NUMERO_Y, compactarCodigo, extrairCodigos, extrairDatas, extrairMoedas,
  extrairNumeros, extrairPessoas, formatarPessoa, partesDaMoeda, soDigitos, type Numero,
} from './formas';
import { type Aprendizado, AprendizadoLayout, type CatalogoGlobal, type ChaveLote, type Convencao, palavrasDaPrimeiraPagina } from './layout';
import { PERFIS, type Perfil, type RegrasFundo, perfilDe } from './perfis';
import {
  type Data, type Moeda, ano, centavos, criarData, deCentavos, deIso, dia, diaDaSemana, formatarData, mes,
  moedaPositiva, normalizarTexto, quantizar, somarDias, textoDoValor,
} from './valores';

export type Obj = Record<string, any>;
/** [página, início, fim] no texto indexado. */
export type Evidencia = [number, number, number];

// ----------------------------------------------------------------------------
// Constantes e rótulos
// ----------------------------------------------------------------------------

const ROTULOS: Record<string, RegExp> = {
  data_vencimento: re('venc(?:imento|to|\\.)?'),
  data_emissao: re(`emiss(?:ao|[^${WS}a-z0-9]o|\\.)|emitid[oa]s? em|data d[oa] (?:contrato|operacao)`),
  valor_total: re('valor'),
  sacado_documento: re('sacado|devedor|pagador(?!a)|destinatario|comprador'),
  cedente_documento: re('cedente|emitente|sacador|beneficiario|vendedor'),
  data_aquisicao: re('data d[ae] (?:aquisicao|cessao|pagamento)'),
};
const RE_ASSINATURA = re('assinad[oa] em|data da assinatura|assinatura em');
const JANELA_ROTULO: Record<string, number> = {
  data_vencimento: 80, data_emissao: 80, valor_total: 80, sacado_documento: 200, cedente_documento: 200,
};
const PALAVRAS_TERMO = ['termo de cessao', 'instrumento particular de cessao', 'cessionari', 'termo de endosso'];
const RE_TERMO_NA_CAPA = re('termo de cessao|termo de endosso|instrumento particular de cessao');
const RE_DOCUMENTO_ACESSORIO = re(`dados${S}+do${S}+segurado|bilhete${S}+(?:de${S}+seguro|numero)`);

const STOPWORDS_NOME = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'de', 'da', 'do', 'das', 'dos',
  'e', 'cia', 'em', 'recuperacao', 'judicial', 'fidc', 'fic', 'rl',
  'responsabilidade', 'limitada',
]);
const STOPWORDS_FUNDO = new Set([
  ...STOPWORDS_NOME,
  'resp', 'np', 'nao', 'padronizado', 'padronizados', 'fundo', 'fundos', 'investimento',
  'investimentos', 'direitos', 'creditorios', 'credito', 'creditos', 'fiagro', 'fidcs',
  'consignado', 'consignados', 'multissetorial', 'i', 'ii', 'iii', 'iv',
]);

const LINHA_CURTA = 40;

/** `texto.find(sub, inicio, fim)` do Python. */
function achar(texto: string, sub: string, inicio = 0, fim = texto.length): number {
  const i = texto.indexOf(sub, Math.max(0, inicio));
  return i >= 0 && i + sub.length <= fim ? i : -1;
}

/** `' '.join(texto.split())[:n]`. */
function compactarEspacos(texto: string, n: number): string {
  return [...split(texto).join(' ')].slice(0, n).join('');
}

function grupos(valor: string): string[] {
  return finditer(RE_DIGITOS, valor).map((m) => lstrip(m[0], '0') || '0');
}

const RE_NAO_ALNUM = /[^a-z0-9]+/g;

/** Texto normalizado só com letras e dígitos, palavras separadas por espaço. */
export function compactar(texto: unknown): string {
  return strip(normalizarTexto(texto ? textoDoValor(texto) : '').replace(RE_NAO_ALNUM, ' '));
}

// ----------------------------------------------------------------------------
// Normalização dos valores da amostra
// ----------------------------------------------------------------------------

function vazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  const t = strip(textoDoValor(valor));
  return t === '' || t === '-';
}

export function normalizarData(valor: unknown): Data | null {
  if (vazio(valor)) return null;
  if (valor instanceof Date) {
    return criarData(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate());
  }
  const texto = [...strip(textoDoValor(valor))].slice(0, 10).join('');
  const iso = deIso(texto);
  if (iso) return iso;
  const datas = extrairDatas(texto);
  return datas.length ? datas[0][1] : null;
}

export function normalizarMoeda(valor: unknown): Moeda | null {
  if (vazio(valor)) return null;
  const c = quantizar(textoDoValor(valor));
  if (c === null) return null;
  return c > BigInt(0) ? deCentavos(c) : null;
}

function dvOk(digitos: string, pesos: number[][]): boolean {
  if (new Set(digitos).size === 1) return false;
  for (const peso of pesos) {
    const corpo = digitos.slice(0, peso.length);
    let soma = 0;
    for (let i = 0; i < peso.length && i < corpo.length; i++) soma += inteiro(corpo[i]) * peso[i];
    const resto = soma % 11;
    if (inteiro(digitos[peso.length]) !== (resto < 2 ? 0 : 11 - resto)) return false;
  }
  return true;
}

const PESOS_CPF = [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]];
const PESOS_CNPJ = [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]];

export function normalizarPessoa(valor: unknown): string | null {
  if (vazio(valor)) return null;
  const digitos = soDigitos(textoDoValor(valor));
  if (digitos.length === 11 || digitos.length === 14) return digitos;
  if (digitos.length >= 6 && digitos.length < 11 && dvOk(zfill(digitos, 11), PESOS_CPF)) return zfill(digitos, 11);
  if (digitos.length > 11 && digitos.length < 14 && dvOk(zfill(digitos, 14), PESOS_CNPJ)) return zfill(digitos, 14);
  return null;
}

export type Chaves = { grupos: string[]; corrido: string; principal: string; trivial: boolean; digitos: string; codigo: string | null };

/** (grupos, dígitos corridos, principal) do nº do documento da amostra. */
export function chavesDocumento(valor: unknown): Chaves | null {
  if (vazio(valor)) return null;
  const texto = lstrip(strip(textoDoValor(valor)), "'");
  const gs = grupos(texto);
  if (!gs.length) return null;
  const digitos = finditer(re(D), texto).map((m) => m[0]).join('');
  const corrido = lstrip(digitos, '0') || '0';
  const codigo = compactarCodigo(normalizarTexto(texto));
  const trivial = corrido === '0' && !codigo;
  return { grupos: gs, corrido, principal: gs[0], trivial, digitos, codigo };
}

export function tokensNome(valor: unknown, stopwords: Set<string> = STOPWORDS_NOME): string[] {
  if (vazio(valor)) return [];
  return split(compactar(textoDoValor(valor))).filter((t) => !stopwords.has(t) && t.length >= 2);
}

// ----------------------------------------------------------------------------
// Estruturas
// ----------------------------------------------------------------------------

const RE_QUEBRA = /\r\n|\n|\r/g;
const MIN_IDENTIFICADORES_LISTAGEM = 5;

export class Pagina {
  datas: [number, Data][];
  moedas: [number, Moeda][];
  pessoas: [number, string][];
  numeros: Numero[];
  inicios_linha: number[];
  codigos: [number, number, string][];
  private _linhasTitulo?: number[];
  private _ehListagem?: boolean;
  _indiceNumeros?: IndiceDeNumeros;
  _digitos?: Map<number, string>;
  _tabelaParcelas?: Map<string, [number, number]>;
  _palavras?: Map<string, [number, number][]>;
  _qtdParcelas?: [number, number][];

  constructor(readonly pdf: string, readonly numero: number, readonly texto: string) {
    this.datas = extrairDatas(texto);
    this.moedas = extrairMoedas(texto);
    this.pessoas = extrairPessoas(texto);
    this.numeros = extrairNumeros(texto);
    const inicios = [0];
    RE_QUEBRA.lastIndex = 0;
    for (let m = RE_QUEBRA.exec(texto); m; m = RE_QUEBRA.exec(texto)) inicios.push(m.index + m[0].length);
    this.inicios_linha = inicios;
    this.codigos = extrairCodigos(texto);
  }

  static deTexto(pdf: string, numero: number, textoNormalizado: string | null | undefined): Pagina {
    return new Pagina(pdf, numero, textoNormalizado || '');
  }

  /** Evidência [página, início, fim] do código compactado entre `inicio` e `fim`, ou null. */
  codigoEm(codigo: string, inicio = 0, fim?: number): Evidencia | null {
    const f = fim === undefined ? this.texto.length : fim;
    for (const [p, pFim, compacto] of this.codigos) {
      if (inicio <= p && p < f && compacto === codigo) return [this.numero, p, pFim];
    }
    return null;
  }

  linha(pos: number): number {
    return bisectRight(this.inicios_linha, pos) - 1;
  }

  /** Índices das linhas com valor E data — em tabela, a linha que fecha cada título. */
  linhasTitulo(): number[] {
    if (this._linhasTitulo === undefined) {
      const datas = new Set(this.datas.map(([p]) => this.linha(p)));
      const linhas = new Set<number>();
      for (const [p, v] of this.moedas) if (moedaPositiva(v) && datas.has(this.linha(p))) linhas.add(this.linha(p));
      this._linhasTitulo = [...linhas].sort((a, b) => a - b);
    }
    return this._linhasTitulo;
  }

  ehTabela(): boolean {
    return this.linhasTitulo().length >= 2;
  }

  /** Tabela em que cada linha de título traz um identificador diferente (listagem de vários devedores). */
  ehListagem(): boolean {
    if (this._ehListagem === undefined) {
      const linhas = new Set(this.linhasTitulo());
      const ids = new Set<string>();
      if (linhas.size >= 2) for (const [p, d] of this.pessoas) if (linhas.has(this.linha(p))) ids.add(d);
      this._ehListagem = ids.size >= MIN_IDENTIFICADORES_LISTAGEM;
    }
    return this._ehListagem;
  }

  fimDaLinha(idx: number): number {
    return idx + 1 < this.inicios_linha.length ? this.inicios_linha[idx + 1] : this.texto.length;
  }

  /** (início, fim) do título da tabela que contém `pos`. */
  regiaoRegistro(pos: number): [number, number] {
    const idx = this.linha(pos);
    const titulos = this.linhasTitulo();
    const k = bisectLeft(titulos, idx);
    if (k === titulos.length) return this.regiaoLinha(pos);
    const fimIdx = titulos[k];
    let inicioIdx = k > 0 ? titulos[k - 1] + 1 : Math.max(0, fimIdx - 3);
    if (fimIdx - inicioIdx > 8) inicioIdx = fimIdx - 3;
    return [this.inicios_linha[inicioIdx], this.fimDaLinha(fimIdx)];
  }

  /** (início, fim) da linha que contém `pos`, com as vizinhas quando a linha é curta. */
  regiaoLinha(pos: number): [number, number] {
    const idx = bisectRight(this.inicios_linha, pos) - 1;
    let inicio = this.inicios_linha[idx];
    let fim = idx + 1 < this.inicios_linha.length ? this.inicios_linha[idx + 1] : this.texto.length;
    if (fim - inicio < LINHA_CURTA) {
      inicio = this.inicios_linha[Math.max(0, idx - 1)];
      fim = idx + 2 < this.inicios_linha.length ? this.inicios_linha[idx + 2] : this.texto.length;
    }
    return [inicio, fim];
  }
}

function em<T>(lista: [number, T][], inicio: number, fim: number): T[] {
  return lista.filter(([p]) => inicio <= p && p < fim).map(([, v]) => v);
}

// ----------------------------------------------------------------------------
// Avaliação campo a campo
// ----------------------------------------------------------------------------

export const PESOS: Record<string, number> = {
  numero_documento: 4.0, valor_total: 3.0, data_vencimento: 2.0,
  sacado_documento: 2.0, cedente_documento: 1.0, data_emissao: 1.0,
  sacado_nome: 1.0, cedente_nome: 0.5,
  data_aquisicao: 1.5, nome_cessionario: 0.5, doc_cessionario: 0.5,
};
const PESO_DOCUMENTO_PARCIAL = 1.5;
const PESO_VENCIMENTO_UM_DIA_ANTES = 1.5;

export const CAMPOS_LASTRO = [
  'numero_documento', 'sacado_nome', 'sacado_documento', 'cedente_nome',
  'cedente_documento', 'valor_total', 'data_emissao', 'data_vencimento',
];
export const CAMPOS_TERMO_EXTRA = ['data_aquisicao', 'nome_cessionario', 'doc_cessionario'];
const CAMPOS_FORTES = ['numero_documento', 'valor_total', 'data_vencimento', 'sacado_documento'];

/** Valores da pendência já normalizados pra comparação. */
export class Amostra {
  fontes: Obj = {};
  nao_enviados: Set<string> = new Set();
  valor_pela_amostra = false;
  administradora = '';

  constructor(
    readonly registro_base_id: any,
    readonly tipos: Set<string>,
    readonly documento: Chaves | null,
    readonly valor: Moeda | null,
    readonly vencimento: Data | null,
    readonly emissao: Data | null,
    readonly aquisicao: Data | null,
    readonly sacado_doc: string | null,
    readonly cedente_doc: string | null,
    readonly fundo_doc: string | null,
    readonly sacado_nome: string[],
    readonly cedente_nome: string[],
    readonly fundo_nome: string[],
    readonly numero_documento_bruto: string,
    readonly tipo_recebivel: string,
    readonly perfil: Perfil,
  ) {}

  static deRegistro(r: Obj, tipos: Iterable<string>): Amostra {
    return new Amostra(
      r.registro_base_id,
      new Set(tipos),
      chavesDocumento(r.base_numero_documento),
      normalizarMoeda(r.base_valor_total),
      normalizarData(r.base_data_vencimento),
      normalizarData(r.base_data_emissao),
      normalizarData(r.base_data_aquisicao),
      normalizarPessoa(r.base_sacado_documento),
      normalizarPessoa(r.base_cedente_documento),
      normalizarPessoa(r.base_cnpj_fundo),
      tokensNome(r.base_sacado_nome),
      tokensNome(r.base_cedente_nome),
      tokensNome(r.base_nome_fundo, STOPWORDS_FUNDO),
      lstrip(strip(r.base_numero_documento ? textoDoValor(r.base_numero_documento) : ''), "'"),
      compactar(r.base_tipo_recebivel),
      perfilDe(r.base_tipo_recebivel),
    );
  }

  /** A amostra traz algum valor pra `campo`? */
  temValor(campo: string): boolean {
    if (campo === 'numero_documento') return !!this.documento && !this.documento.trivial;
    const v = ({
      sacado_nome: this.sacado_nome, sacado_documento: this.sacado_doc,
      cedente_nome: this.cedente_nome, cedente_documento: this.cedente_doc,
      valor_total: this.valor, data_emissao: this.emissao,
      data_vencimento: this.vencimento, data_aquisicao: this.aquisicao,
      nome_cessionario: this.fundo_nome, doc_cessionario: this.fundo_doc,
    } as Obj)[campo];
    return Array.isArray(v) ? v.length > 0 : !!v;
  }
}

const RE_FIM_NUMERICO_Y = re(`[${D}.,/\\-]*${D}`, 'y');

/** Fim do valor (data, moeda, CPF/CNPJ, nº) que começa em `pos`. */
function fimValor(texto: string, pos: number): number {
  const m = matchEm(RE_DATA_EXTENSO_Y, texto, pos) || matchEm(RE_FIM_NUMERICO_Y, texto, pos);
  return m ? m.index + m[0].length : pos + 1;
}

function trecho(pagina: Pagina, pos: number): Evidencia {
  return [pagina.numero, pos, fimValor(pagina.texto, pos)];
}

function fonteDocumento(pagina: Pagina, rotulo: string | null = null): Obj {
  return { tipo: 'documento', arquivo: pagina.pdf, pagina: pagina.numero, rotulo };
}

function st(valor: string, encontrado: any = null, evidencias: any[] | null = null, regra: string | null = null): Obj {
  const s: Obj = { valor, encontrado };
  if (evidencias && evidencias.length) s.evidencias = evidencias;
  if (regra) s.regra = regra;
  return s;
}

const MIN_DIGITOS_NUMERO_CONTIDO = 8;
const MIN_DIGITOS_NUMERO_FINAL = 6;
const MIN_DIGITOS_NUMERO_LINHA = 6;

function igualLista(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 'exato', 'parcela' ou null — o nº do PDF confere com o da amostra? */
export function numeroConfere(chaves: Chaves, gs: string[], corrido: string, comParcela = false, digitos: string | null = null): 'exato' | 'parcela' | null {
  const curto = !!chaves.codigo && corrido.length < MIN_DIGITOS_NUMERO_LINHA;
  if (igualLista(gs, chaves.grupos) || corrido === chaves.corrido) return curto ? null : 'exato';
  if (!comParcela || curto) return null;
  if (chaves.grupos.length >= 2 && chaves.grupos[chaves.grupos.length - 1].length <= 3 && chaves.principal.length >= 4
      && igualLista(gs, chaves.grupos.slice(0, -1))) return 'parcela';
  if (chaves.codigo || corrido.length < 5) return null;
  const sobra = chaves.corrido.length - corrido.length;
  if (sobra >= 2 && sobra <= 3 && chaves.corrido.startsWith(corrido)) return 'parcela';
  for (const [pdf, amostra] of [[corrido, chaves.corrido], [digitos, chaves.digitos]] as [string | null, string | null][]) {
    if (pdf && amostra && pdf.length >= MIN_DIGITOS_NUMERO_CONTIDO && amostra.length - pdf.length >= 2 && amostra.includes(pdf)) {
      return 'parcela';
    }
  }
  if (chaves.corrido.length >= MIN_DIGITOS_NUMERO_FINAL && corrido.length > chaves.corrido.length
      && corrido.endsWith(chaves.corrido)) return 'parcela';
  return null;
}

class IndiceDeNumeros {
  readonly grupos = new Set<string>();
  readonly grupos_longos = new Set<string>();
  readonly corridos = new Set<string>();
  private _sufixos: Set<string> | null = null;
  private _digitos: Set<string> | null = null;

  constructor(private readonly pagina: Pagina) {
    for (const [, gs, corrido] of pagina.numeros) {
      const k = gs.join(',');
      this.grupos.add(k);
      this.corridos.add(corrido);
      if (corrido.length >= MIN_DIGITOS_NUMERO_LINHA) this.grupos_longos.add(k);
    }
  }

  sufixos(): Set<string> {
    if (this._sufixos === null) {
      this._sufixos = new Set();
      for (const corrido of this.corridos) {
        for (let tamanho = MIN_DIGITOS_NUMERO_FINAL; tamanho < corrido.length; tamanho++) {
          this._sufixos.add(corrido.slice(-tamanho));
        }
      }
    }
    return this._sufixos;
  }

  digitos(): Set<string> {
    if (this._digitos === null) {
      this._digitos = new Set();
      for (const [p] of this.pagina.numeros) {
        const d = digitosEm(this.pagina, p);
        if (d) this._digitos.add(d);
      }
    }
    return this._digitos;
  }
}

function indiceDeNumeros(pagina: Pagina): IndiceDeNumeros {
  if (!pagina._indiceNumeros) pagina._indiceNumeros = new IndiceDeNumeros(pagina);
  return pagina._indiceNumeros;
}

function algumTrechoEm(texto: string, minimo: number, conjunto: Set<string>): boolean {
  for (let tamanho = minimo; tamanho < texto.length - 1; tamanho++) {
    for (let ini = 0; ini < texto.length - tamanho + 1; ini++) {
      if (conjunto.has(texto.slice(ini, ini + tamanho))) return true;
    }
  }
  return false;
}

/** false garante que nenhum número da página confere com o nº da amostra. */
export function numeroPodeEstarNaPagina(chaves: Chaves, pagina: Pagina, comParcela = false, comDigitos = false): boolean {
  const idx = indiceDeNumeros(pagina);
  const corrido = chaves.corrido;
  const gs = chaves.grupos;
  const codigo = !!chaves.codigo;
  if (!(codigo && corrido.length < MIN_DIGITOS_NUMERO_LINHA) && (idx.corridos.has(corrido) || idx.grupos.has(gs.join(',')))) return true;
  if (!comParcela) return false;
  if (gs.length >= 2 && gs[gs.length - 1].length <= 3 && chaves.principal.length >= 4
      && (codigo ? idx.grupos_longos : idx.grupos).has(gs.slice(0, -1).join(','))) return true;
  if (codigo) return false;
  for (const corte of [2, 3]) {
    const prefixo = corrido.slice(0, Math.max(0, corrido.length - corte));
    if (prefixo.length >= 5 && idx.corridos.has(prefixo)) return true;
  }
  if (algumTrechoEm(corrido, MIN_DIGITOS_NUMERO_CONTIDO, idx.corridos)) return true;
  if (comDigitos && chaves.digitos && algumTrechoEm(chaves.digitos, MIN_DIGITOS_NUMERO_CONTIDO, idx.digitos())) return true;
  return corrido.length >= MIN_DIGITOS_NUMERO_FINAL && idx.sufixos().has(corrido);
}

export function numeroNoDocumento(chaves: Chaves, paginasPdf: Pagina[], comParcela = false): boolean {
  return paginasPdf.some((pg) => numeroPodeEstarNaPagina(chaves, pg, comParcela)
    && pg.numeros.some(([, g, c]) => numeroConfere(chaves, g, c, comParcela) !== null));
}

function digitosEm(pagina: Pagina, pos: number): string {
  if (!pagina._digitos) pagina._digitos = new Map();
  let d = pagina._digitos.get(pos);
  if (d === undefined) {
    const m = matchEm(RE_NUMERO_Y, pagina.texto, pos);
    d = m ? soDigitos(m[0]) : '';
    pagina._digitos.set(pos, d);
  }
  return d;
}

function confereNaPagina(chaves: Chaves, pagina: Pagina, pos: number, gs: string[], corrido: string, comParcela: boolean) {
  let como = numeroConfere(chaves, gs, corrido, comParcela);
  if (como === null && comParcela && (chaves.digitos ?? '').length - corrido.length >= 2) {
    como = numeroConfere(chaves, gs, corrido, comParcela, digitosEm(pagina, pos));
  }
  return como;
}

function statusNumero(pagina: Pagina, pos: number, como: string | null): Obj {
  return st('V', null, [trecho(pagina, pos)], como === 'parcela' ? 'numero_com_parcela' : null);
}

function numeroUnicoDaLinha(pagina: Pagina, inicio: number, fim: number): [number, string] | null {
  const ocupados = new Set([...pagina.pessoas.map(([p]) => p), ...pagina.datas.map(([p]) => p), ...pagina.moedas.map(([p]) => p)]);
  const achados: number[] = [];
  for (const [p, , corrido] of pagina.numeros) {
    if (inicio <= p && p < fim && !ocupados.has(p) && corrido.length >= MIN_DIGITOS_NUMERO_LINHA) achados.push(p);
  }
  if (achados.length !== 1) return null;
  const pos = achados[0];
  return [pos, pagina.texto.slice(pos, fimValor(pagina.texto, pos))];
}

function avaliarDocumento(amostra: Amostra, pagina: Pagina, inicio: number, fim: number, modoLinha = false): [Obj, number] {
  const chaves = amostra.documento;
  if (chaves && chaves.trivial && split(amostra.tipo_recebivel).includes('ccb')) return [st('V', null, null, 'ccb_sem_numero'), 0];
  if (!chaves || chaves.trivial) return [st('P'), 0];
  if (chaves.codigo) {
    const evidencia = pagina.codigoEm(chaves.codigo, inicio, fim);
    if (evidencia) return [st('V', null, [evidencia]), PESOS.numero_documento];
  }
  let parcial = false;
  const comParcela = amostra.perfil.numero_com_parcela;
  const pode = numeroPodeEstarNaPagina(chaves, pagina, comParcela, true);
  for (const [p, gs, corrido] of pagina.numeros) {
    if (!(inicio <= p && p < fim)) continue;
    const como = pode ? confereNaPagina(chaves, pagina, p, gs, corrido, comParcela) : null;
    if (como) return [statusNumero(pagina, p, como), PESOS.numero_documento];
    if (chaves.principal.length >= 4 && gs[0] === chaves.principal) parcial = true;
  }
  if (modoLinha && !parcial && amostra.perfil.corrige_numero_da_linha) {
    const unico = numeroUnicoDaLinha(pagina, inicio, fim);
    if (unico) {
      const [pos, texto] = unico;
      return [st('D', texto, [trecho(pagina, pos)]), 0];
    }
  }
  return [st('P'), parcial ? PESO_DOCUMENTO_PARCIAL : 0];
}

const RE_SEPARADOR_COLADO_Y = re(`[${WS}:.\\-–|]*(?:n[º°o.]?${S}*:?${S}*)?`, 'y');

function colado(texto: string, fimRotulo: number, posValor: number): boolean {
  if (fimRotulo > posValor) return false;
  const m = matchEm(RE_SEPARADOR_COLADO_Y, texto, fimRotulo, posValor);
  return m !== null && m.index + m[0].length === posValor;
}

function valorAposRotulo<T>(
  pagina: Pagina, campo: string, inicio: number, fim: number, lista: [number, T][],
  janela: number | null = null, mesmaLinha = false, rotulo: RegExp | null = null,
): [number, T] | null {
  const r = rotulo || ROTULOS[campo];
  const j = janela || JANELA_ROTULO[campo];
  for (const m of finditer(r, pagina.texto, inicio, fim)) {
    const fimM = m.index + m[0].length;
    let limite = Math.min(fimM + j, fim);
    if (mesmaLinha) {
      const quebra = achar(pagina.texto, '\n', fimM, limite);
      limite = quebra >= 0 ? quebra : limite;
    }
    for (const [p, v] of lista) {
      if (fimM <= p && p < limite && (!mesmaLinha || colado(pagina.texto, fimM, p))) return [p, v];
    }
  }
  return null;
}

const RE_PRIMEIRA_PARCELA = re(`vencimento${S}+da${S}+1${NS}{0,2}${S}+parcela|primeiro${S}+vencimento|vencimento${S}+das${S}+parcelas`);
const RE_ULTIMA_PARCELA = re(`vencimento${S}+final|ultimo${S}+vencimento|vencimento${S}+da${S}+ultima${S}+parcela`);
const RE_QTD_PARCELAS = re(`(?:quantidade|qtde?\\.?|numero)${S}+de${S}+parcelas${S}*:?${S}*(${D}{1,3})`);

/** `_somar_meses` do Python (dia que não existe no mês cai pra 30, 29, 28). */
export function somarMeses(d: Data, meses: number): Data | null {
  const total = mes(d) - 1 + meses;
  const a = ano(d) + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12 + 1;
  for (const diaN of [dia(d), 30, 29, 28]) {
    const r = criarData(a, m, diaN);
    if (r) return r;
  }
  return null;
}

function datasApos(pagina: Pagina, regex: RegExp, inicio: number, fim: number, janela = 30): [number, Data][] {
  const datas: [number, Data][] = [];
  for (const m of finditer(regex, pagina.texto, inicio, fim)) {
    const fimM = m.index + m[0].length;
    const quebra = achar(pagina.texto, '\n', fimM, fimM + janela);
    const limite = quebra >= 0 ? quebra : fimM + janela;
    let achadas = pagina.datas.filter(([p]) => fimM <= p && p < limite);
    if (!achadas.length && quebra >= 0) {
      achadas = pagina.datas.filter(([p]) => fimM <= p && p < fimM + janela && colado(pagina.texto, fimM, p)).slice(0, 1);
    }
    datas.push(...achadas);
  }
  return datas;
}

function minPor<T>(lista: T[], chave: (x: T) => string | number): T {
  let melhor = lista[0];
  for (const x of lista) if (chave(x) < chave(melhor)) melhor = x;
  return melhor;
}

function maxPor<T>(lista: T[], chave: (x: T) => string | number): T {
  let melhor = lista[0];
  for (const x of lista) if (chave(x) > chave(melhor)) melhor = x;
  return melhor;
}

/** Evidências (1ª parcela e final) se `esperado` é uma das parcelas mensais do cronograma impresso. */
export function parcelaNoCronograma(pagina: Pagina, inicio: number, fim: number, esperado: Data): Evidencia[] | null {
  const primeiras = datasApos(pagina, RE_PRIMEIRA_PARCELA, inicio, fim);
  if (!primeiras.length) return null;
  const [posPrimeira, primeira] = minPor(primeiras, (x) => x[1]);
  const evidencias: Evidencia[] = [trecho(pagina, posPrimeira)];
  const ultimas = datasApos(pagina, RE_ULTIMA_PARCELA, inicio, fim);
  let ultima: Data | null;
  if (ultimas.length) {
    const [posUltima, u] = maxPor(ultimas, (x) => x[1]);
    ultima = u;
    evidencias.push(trecho(pagina, posUltima));
  } else {
    const qtd = search(RE_QTD_PARCELAS, pagina.texto, inicio, fim);
    if (!qtd) return null;
    ultima = somarMeses(primeira, inteiro(qtd[1]) - 1);
    evidencias.push([pagina.numero, qtd.index, qtd.index + qtd[0].length]);
  }
  if (!ultima || !(primeira <= esperado && esperado <= ultima)) return null;
  const meses = (ano(esperado) - ano(primeira)) * 12 + mes(esperado) - mes(primeira);
  return somarMeses(primeira, meses) === esperado ? evidencias : null;
}

const RE_LINHA_TABELA_PARCELAS = re(`(?<![${D}/.,])${D}{1,3}${S}+(${D}{2}/${D}{2}/${D}{4})${S}*r\\$${S}?${D}`, 'd');
const MIN_LINHAS_TABELA_PARCELAS = 3;

/** Evidência da linha da tabela de parcelas com o vencimento `esperado`; null sem tabela com essa data. */
export function parcelaNaTabela(paginasPdf: Pagina[], esperado: Data | null): Evidencia | null {
  if (esperado === null) return null;
  const alvo = formatarData(esperado, '/');
  for (const pg of paginasPdf) {
    if (!pg._tabelaParcelas) {
      const linhas = finditer(RE_LINHA_TABELA_PARCELAS, pg.texto);
      const tabela = new Map<string, [number, number]>();
      if (linhas.length >= MIN_LINHAS_TABELA_PARCELAS) {
        for (const m of linhas) if (!tabela.has(m[1])) tabela.set(m[1], [m.indices![1][0], m.indices![1][1]]);
      }
      pg._tabelaParcelas = tabela;
    }
    const achado = pg._tabelaParcelas.get(alvo);
    if (achado) return [pg.numero, achado[0], achado[1]];
  }
  return null;
}

const JANELA_ROTULO_COLADO = 30;
const CAMPOS_DOC_PESSOA = ['sacado_documento', 'cedente_documento'];

function avaliarSimples(
  campo: string, esperado: string | null, pagina: Pagina, inicio: number, fim: number, lista: [number, string][],
  modoLinha: boolean, formatar: (v: string) => string, rotulo: RegExp | null = null,
): [Obj, number] {
  if (esperado === null) return [st('P'), 0];
  if (!modoLinha && campo === 'data_vencimento') {
    const cronograma = parcelaNoCronograma(pagina, inicio, fim, esperado);
    if (cronograma) return [st('V', null, cronograma, 'cronograma_parcelas'), PESOS[campo]];
    const tabela = parcelaNaTabela([pagina], esperado);
    if (tabela && inicio <= tabela[1] && tabela[1] < fim) return [st('V', null, [tabela], 'parcela_na_tabela'), PESOS[campo]];
  }
  if (!modoLinha && (campo === 'data_vencimento' || campo === 'data_emissao')) {
    const col = valorAposRotulo(pagina, campo, inicio, fim, lista, JANELA_ROTULO_COLADO, true);
    if (col !== null) {
      const [pos, valor] = col;
      if (valor === esperado) return [st('V', null, [trecho(pagina, pos)]), PESOS[campo]];
      if (campo === 'data_emissao' && datasAntesDoVencimento(esperado).includes(valor)) {
        return [st('D', formatar(valor), [trecho(pagina, pos)], 'planilha_um_dia_depois'), 0];
      }
      if (campo === 'data_vencimento') {
        const umDia = vencimentoUmDiaAntes(pagina, inicio, fim, esperado, modoLinha);
        if (umDia) return [umDia, PESO_VENCIMENTO_UM_DIA_ANTES];
      }
      return [st('D', formatar(valor), [trecho(pagina, pos)]), 0];
    }
  }
  const iguais = lista.filter(([p, v]) => inicio <= p && p < fim && v === esperado
    && !(campo === 'valor_total' && valorDeEncargo(pagina.texto, p))).map(([p]) => p);
  if (iguais.length) return [st('V', null, [trecho(pagina, iguais[0])]), PESOS[campo]];
  if (CAMPOS_DOC_PESSOA.includes(campo)) {
    const filiais = lista.filter(([p, v]) => inicio <= p && p < fim && mesmaRaizCnpj(v, esperado)).map(([p]) => p);
    if (filiais.length) return [st('V', null, [trecho(pagina, filiais[0])], 'cnpj_mesma_raiz'), PESOS[campo]];
  }
  if (campo === 'data_vencimento') {
    const umDia = vencimentoUmDiaAntes(pagina, inicio, fim, esperado, modoLinha);
    if (umDia) return [umDia, PESO_VENCIMENTO_UM_DIA_ANTES];
  }
  let encontrado: [number, string] | null = null;
  if (modoLinha) {
    if (campo === 'valor_total') {
      const naLinha = lista.filter(([p, v]) => inicio <= p && p < fim && moedaPositiva(v));
      if (new Set(naLinha.map(([, v]) => v)).size === 1) encontrado = naLinha[0];
    }
  } else if (campo in ROTULOS) {
    encontrado = valorAposRotulo(pagina, campo, inicio, fim, lista, null, false, rotulo);
    if (campo === 'valor_total' && encontrado !== null && !moedaPositiva(encontrado[1])) encontrado = null;
  }
  if (encontrado !== null && encontrado[1] !== esperado) return [st('D', formatar(encontrado[1]), [trecho(pagina, encontrado[0])]), 0];
  return [st('P'), 0];
}

const JANELA_NOME = 80;
const SIGLAS_NOME: Record<string, string> = {
  scd: `sociedade${S}+de${S}+credito${S}+direto`,
  scfi: `sociedade${S}+de${S}+credito${S}*,?${S}+financiamento${S}+e${S}+investimento`,
  sep: `sociedade${S}+de${S}+emprestimo${S}+entre${S}+pessoas`,
  dtvm: `distribuidora${S}+de${S}+titulos${S}+e${S}+valores${S}+mobiliarios`,
  ctvm: `corretora${S}+de${S}+titulos${S}+e${S}+valores${S}+mobiliarios`,
};
const REGEX_PALAVRA = new Map<string, RegExp>();

/** Regex da palavra inteira do nome, ou da sigla e do seu extenso. */
export function regexDaPalavra(palavra: string): RegExp {
  let r = REGEX_PALAVRA.get(palavra);
  if (!r) {
    const padrao = escapar(palavra) + (palavra in SIGLAS_NOME ? `|${SIGLAS_NOME[palavra]}` : '');
    r = re(`(?<![a-z0-9])(?:${padrao})(?![a-z0-9])`);
    REGEX_PALAVRA.set(palavra, r);
  }
  return r;
}

/** Datas do PDF que valem no lugar do vencimento da planilha: o dia anterior (e o sábado, se a planilha traz segunda). */
function datasAntesDoVencimento(esperado: Data): Data[] {
  const datas = [somarDias(esperado, -1)];
  if (diaDaSemana(esperado) === 0) datas.push(somarDias(esperado, -2));
  return datas;
}

function vencimentoUmDiaAntes(pagina: Pagina, inicio: number, fim: number, esperado: Data, modoLinha: boolean): Obj | null {
  for (const dataPdf of datasAntesDoVencimento(esperado)) {
    if (!modoLinha) {
      const cronograma = parcelaNoCronograma(pagina, inicio, fim, dataPdf);
      if (cronograma) {
        return { ...st('D', dataPdf, cronograma, 'vencimento_um_dia_antes'), fonte: fonteDocumento(pagina, 'Cronograma de parcelas') };
      }
    }
    const posicoes = pagina.datas.filter(([p, d]) => inicio <= p && p < fim && d === dataPdf).map(([p]) => p);
    if (posicoes.length) {
      return {
        ...st('D', dataPdf, [trecho(pagina, posicoes[0])], 'vencimento_um_dia_antes'),
        fonte: fonteDocumento(pagina, modoLinha ? 'Linha do título' : null),
      };
    }
  }
  return null;
}

function ocorrenciasDaPalavra(pagina: Pagina, palavra: string): [number, number][] {
  if (!pagina._palavras) pagina._palavras = new Map();
  let achadas = pagina._palavras.get(palavra);
  if (achadas === undefined) {
    achadas = pagina.texto.includes(palavra) || palavra in SIGLAS_NOME
      ? finditer(regexDaPalavra(palavra), pagina.texto).map((m) => [m.index, m.index + m[0].length] as [number, number])
      : [];
    pagina._palavras.set(palavra, achadas);
  }
  return achadas;
}

/** `regioes`: [(pagina, inicio, fim)] onde procurar o nome. */
function avaliarNome(campo: string, tokens: string[], regioes: [Pagina, number, number][]): [Obj, number] {
  if (!tokens.length) return [st('P'), 0];
  const ocorrencias: [number, number, number, string][] = [];
  for (const [pagina, inicio, fim] of regioes) {
    const texto = pagina.texto;
    if (inicio === 0 && fim >= texto.length) {
      for (const t of tokens) for (const [ini, fimM] of ocorrenciasDaPalavra(pagina, t)) ocorrencias.push([pagina.numero, ini, fimM, t]);
      continue;
    }
    let trechoTxt: string | null = null;
    for (const t of tokens) {
      if (!(t in SIGLAS_NOME) && achar(texto, t, inicio, fim) < 0) continue;
      if (trechoTxt === null) trechoTxt = texto.slice(inicio, fim);
      for (const m of finditer(regexDaPalavra(t), trechoTxt)) ocorrencias.push([pagina.numero, inicio + m.index, inicio + m.index + m[0].length, t]);
    }
  }
  let evidencias = new Map<string, Evidencia>();
  let melhor: [number, number] = [0, 0];
  const ordenadas = ordenar(ocorrencias, (o) => [o[0], o[1]]);
  const comparar = (o: [number, number, number, string], pg: number, pos: number) => (o[0] !== pg ? o[0] - pg : o[1] - pos);
  for (const [paginaAncora, posAncora] of ocorrencias) {
    let lo = 0;
    let hi = ordenadas.length;
    while (lo < hi) {
      const meio = (lo + hi) >> 1;
      if (comparar(ordenadas[meio], paginaAncora, posAncora) < 0) lo = meio + 1;
      else hi = meio;
    }
    const perto = new Map<string, Evidencia>();
    for (let k = lo; k < ordenadas.length; k++) {
      const [pg, ini, fimM, t] = ordenadas[k];
      if (pg !== paginaAncora || ini > posAncora + JANELA_NOME) break;
      if (!perto.has(t)) perto.set(t, [pg, ini, fimM]);
    }
    if (!perto.size) continue;
    const valores = [...perto.values()];
    const extensao = Math.max(...valores.map((e) => e[2])) - Math.min(...valores.map((e) => e[1]));
    if (compararTuplas([perto.size, -extensao], melhor) > 0) {
      evidencias = perto;
      melhor = [perto.size, -extensao];
    }
  }
  const presentes = evidencias.size;
  if (presentes === tokens.length || (presentes >= 2 && presentes / tokens.length >= 0.75)) {
    return [st('V', null, [...evidencias.values()]), PESOS[campo]];
  }
  return [st('P'), 0];
}

function fmtMoeda(v: string): string {
  return v;
}

function fmtData(d: string): string {
  return d;
}

function vencimentoImpresso(pagina: Pagina, inicio: number, fim: number, modoLinha: boolean): [number, Data] | null {
  if (modoLinha) {
    const datas = pagina.datas.filter(([p]) => inicio <= p && p < fim);
    return datas.length ? datas[datas.length - 1] : null;
  }
  let datas = datasApos(pagina, RE_PRIMEIRA_PARCELA, inicio, fim);
  if (!datas.length) datas = datasApos(pagina, ROTULOS.data_vencimento, inicio, fim);
  return datas.length ? datas[0] : null;
}

/** Status e score dos 8 campos comuns numa região de uma página. */
function avaliarRegiao(amostra: Amostra, pagina: Pagina, inicio: number, fim: number, modoLinha: boolean): [Obj, number] {
  const campos: Obj = {};
  let score = 0;
  let s: number;
  [campos.numero_documento, s] = avaliarDocumento(amostra, pagina, inicio, fim, modoLinha);
  score += s;
  const simples: [string, string | null, [number, string][], (v: string) => string][] = [
    ['valor_total', amostra.valor, pagina.moedas, fmtMoeda],
    ['data_vencimento', amostra.vencimento, pagina.datas, fmtData],
    ['data_emissao', amostra.emissao, pagina.datas, fmtData],
    ['sacado_documento', amostra.sacado_doc, pagina.pessoas, formatarPessoa],
    ['cedente_documento', amostra.cedente_doc, pagina.pessoas, formatarPessoa],
  ];
  for (const [campo, esperado, lista, fmt] of simples) {
    [campos[campo], s] = avaliarSimples(campo, esperado, pagina, inicio, fim, lista, modoLinha, fmt, amostra.perfil.rotulo(campo));
    score += s;
  }
  if (amostra.vencimento === null) {
    const impresso = vencimentoImpresso(pagina, inicio, fim, modoLinha);
    if (impresso) {
      const [pos, dataImpressa] = impresso;
      campos.data_vencimento = {
        ...st('D', dataImpressa, [trecho(pagina, pos)], 'planilha_sem_vencimento'),
        fonte: fonteDocumento(pagina, modoLinha ? 'Linha do título' : 'Vencimento no documento'),
      };
    }
  }
  for (const [campo, tokens] of [['sacado_nome', amostra.sacado_nome], ['cedente_nome', amostra.cedente_nome]] as [string, string[]][]) {
    [campos[campo], s] = avaliarNome(campo, tokens, [[pagina, inicio, fim]]);
    score += s;
  }
  if (amostra.perfil.ancora_por_nome && campos.sacado_nome.valor === 'V') score += PESOS.sacado_documento - PESOS.sacado_nome;
  return [campos, score];
}

function primeiraOcorrencia(paginas: Pagina[], atributo: 'pessoas' | 'datas' | 'moedas', alvo: string): Evidencia | null {
  for (const pg of paginas) for (const [p, v] of pg[atributo]) if (v === alvo) return trecho(pg, p);
  return null;
}

function mesmaRaizCnpj(doc: string, esperado: string): boolean {
  return doc.length === 14 && esperado.length === 14 && doc !== esperado && doc.slice(0, 8) === esperado.slice(0, 8);
}

function ocorrenciaDaPessoa(paginas: Pagina[], doc: string): [Evidencia | null, string | null] {
  const evidencia = primeiraOcorrencia(paginas, 'pessoas', doc);
  if (evidencia) return [evidencia, null];
  for (const pg of paginas) for (const [p, v] of pg.pessoas) if (mesmaRaizCnpj(v, doc)) return [trecho(pg, p), 'cnpj_mesma_raiz'];
  return [null, null];
}

type Achada = [Pagina, number, Data];

/** (página, posição, data) da primeira data colada a um rótulo. */
function dataApos(paginas: Pagina[], regex: RegExp): Achada | null {
  for (const pg of paginas) {
    for (const m of finditer(regex, pg.texto)) {
      const fimM = m.index + m[0].length;
      const limite = fimM + JANELA_ROTULO_COLADO;
      for (const [p, d] of pg.datas) if (fimM <= p && p < limite && colado(pg.texto, fimM, p)) return [pg, p, d];
    }
  }
  return null;
}

const RE_DIA_DA_SEMANA = re(`(?:segunda|terca|quarta|quinta|sexta)[${WS}\\-]feira,?${S}*`);
const RE_LOCAL_E_DATA = re(`(?:^|\\n)${S}*[a-z][a-z ]{2,29},${S}*(?=${D}{1,2}${S}+de${S}+[a-z]+${S}+de${S}+${D}{4})`);

function avaliarAquisicao(esperado: Data | null, paginasPdf: Pagina[]): Obj {
  const cabecalho = paginasPdf.slice(0, 3);
  const fimDoc = paginasPdf.slice(-2);
  if (!esperado) {
    const opcoes: [RegExp, Pagina[], string][] = [
      [ROTULOS.data_aquisicao, cabecalho, 'Data de Pagamento / aquisição do termo'],
      [RE_ASSINATURA, [...fimDoc].reverse(), 'Data da assinatura'],
      [ROTULOS.data_emissao, cabecalho, 'Data de Emissão'],
    ];
    for (const [regex, paginas, rotulo] of opcoes) {
      const achada = dataApos(paginas, regex);
      if (achada) {
        const [pg, pos, dataPdf] = achada;
        return { ...st('D', dataPdf, [trecho(pg, pos)], 'planilha_vazia_vale_documento'), fonte: fonteDocumento(pg, rotulo) };
      }
    }
    return st('P');
  }
  const explicita = dataApos(cabecalho, ROTULOS.data_aquisicao);
  if (explicita) {
    const [pg, pos, dataPdf] = explicita;
    const fonte = fonteDocumento(pg, 'Data de Pagamento / aquisição do termo');
    if (dataPdf === esperado) return { ...st('V', null, [trecho(pg, pos)]), fonte };
    const regra = datasAntesDoVencimento(esperado).includes(dataPdf) ? 'planilha_um_dia_depois' : null;
    return { ...st('D', dataPdf, [trecho(pg, pos)], regra), fonte };
  }
  const dataDoTermo = dataApos(paginasPdf, RE_DIA_DA_SEMANA);
  if (dataDoTermo && dataDoTermo[2] === esperado) {
    const [pg, pos] = dataDoTermo;
    return { ...st('V', null, [trecho(pg, pos)], 'data_do_termo'), fonte: fonteDocumento(pg, 'Data do termo') };
  }
  const localEData = dataApos(paginasPdf, RE_LOCAL_E_DATA);
  if (localEData && localEData[2] === esperado) {
    const [pg, pos] = localEData;
    return { ...st('V', null, [trecho(pg, pos)], 'data_do_termo'), fonte: fonteDocumento(pg, 'Data do termo (local e data)') };
  }
  const assinatura = dataApos([...fimDoc].reverse(), RE_ASSINATURA);
  if (assinatura && assinatura[2] === esperado) {
    return {
      ...st('V', null, [trecho(assinatura[0], assinatura[1])], 'data_assinatura'),
      fonte: fonteDocumento(assinatura[0], 'Data da assinatura'),
    };
  }
  const emissao = dataApos(cabecalho, ROTULOS.data_emissao);
  if (emissao && emissao[2] === esperado) {
    return {
      ...st('V', null, [trecho(emissao[0], emissao[1])], 'aquisicao_igual_emissao'),
      fonte: fonteDocumento(emissao[0], 'Data de Emissão'),
    };
  }
  for (const pg of paginasPdf) {
    const posicoes = pg.datas.filter(([, d]) => d === esperado).map(([p]) => p);
    if (posicoes.length) return { ...st('V', null, [trecho(pg, posicoes[0])]), fonte: fonteDocumento(pg) };
  }
  if (assinatura) {
    const [pg, pos, dataPdf] = assinatura;
    return { ...st('D', dataPdf, [trecho(pg, pos)], 'data_assinatura'), fonte: fonteDocumento(pg, 'Data da assinatura') };
  }
  if (emissao) {
    const [pg, pos, dataPdf] = emissao;
    return { ...st('D', dataPdf, [trecho(pg, pos)], 'aquisicao_igual_emissao'), fonte: fonteDocumento(pg, 'Data de Emissão') };
  }
  return st('P');
}

const RE_ROTULO_CESSIONARIO = re(`cession[aá]ri[ao]s?${B}`);
const JANELA_CNPJ_CESSIONARIO = 250;

function cessionarioDoTermo(paginasPdf: Pagina[], amostra: Amostra): [Pagina, number, string] | null {
  for (const pg of paginasPdf) {
    for (const m of finditer(RE_ROTULO_CESSIONARIO, pg.texto)) {
      const fimM = m.index + m[0].length;
      for (const [pos, doc] of pg.pessoas) {
        if (fimM <= pos && pos <= fimM + JANELA_CNPJ_CESSIONARIO && doc.length === 14 && doc !== amostra.cedente_doc) return [pg, pos, doc];
      }
    }
  }
  return null;
}

/** Os 3 campos de Termo são do DOCUMENTO (cabeçalho do termo): procura no PDF inteiro. */
export function avaliarExtrasTermo(amostra: Amostra, paginasPdf: Pagina[]): [Obj, number] {
  const campos: Obj = {};
  let score = 0;
  const cabecalho = paginasPdf.slice(0, 3);
  campos.data_aquisicao = avaliarAquisicao(amostra.aquisicao, paginasPdf);
  score += campos.data_aquisicao.valor === 'V' ? PESOS.data_aquisicao : 0;
  const evid = amostra.fundo_doc ? primeiraOcorrencia(paginasPdf, 'pessoas', amostra.fundo_doc) : null;
  campos.doc_cessionario = evid ? st('V', null, [evid]) : st('P');
  score += evid ? PESOS.doc_cessionario : 0;
  const regioesCabecalho: [Pagina, number, number][] = cabecalho.map((pg) => [pg, 0, pg.texto.length]);
  const regioesTodas: [Pagina, number, number][] = paginasPdf.map((pg) => [pg, 0, pg.texto.length]);
  let s: number;
  [campos.nome_cessionario, s] = avaliarNome('nome_cessionario', amostra.fundo_nome, regioesCabecalho);
  if (campos.nome_cessionario.valor !== 'V' && paginasPdf.length > cabecalho.length) {
    [campos.nome_cessionario, s] = avaliarNome('nome_cessionario', amostra.fundo_nome, regioesTodas);
  }
  if (campos.nome_cessionario.valor !== 'V' && campos.doc_cessionario.valor === 'V') {
    campos.nome_cessionario = st('V', null, campos.doc_cessionario.evidencias, 'cessionario_pelo_cnpj');
  }
  if (!evid && amostra.fundo_doc && campos.nome_cessionario.valor !== 'V') {
    const outro = cessionarioDoTermo(cabecalho, amostra);
    if (outro) {
      const [pg, pos, doc] = outro;
      campos.doc_cessionario = st('D', formatarPessoa(doc), [trecho(pg, pos)], 'cessionario_outro_cnpj');
    }
  }
  score += s;
  const [evidCedente, regra] = amostra.cedente_doc ? ocorrenciaDaPessoa(cabecalho, amostra.cedente_doc) : [null, null];
  if (evidCedente) campos.cedente_documento = st('V', null, [evidCedente], regra);
  let [nomeCedente] = avaliarNome('cedente_nome', amostra.cedente_nome, regioesCabecalho);
  if (nomeCedente.valor !== 'V' && paginasPdf.length > cabecalho.length) {
    [nomeCedente] = avaliarNome('cedente_nome', amostra.cedente_nome, regioesTodas);
  }
  if (nomeCedente.valor === 'V') campos.cedente_nome = nomeCedente;
  return [campos, score];
}

// ----------------------------------------------------------------------------
// Índice da base e busca de candidatos
// ----------------------------------------------------------------------------

const CHAVE_ANCORA = 1e8;
const ancora = (i: number, p: number) => i * CHAVE_ANCORA + p;
const paginaDaAncora = (k: number) => Math.floor(k / CHAVE_ANCORA);
const posDaAncora = (k: number) => k % CHAVE_ANCORA;

export type InfoPdfExterno = { base_id?: string | number; rotulo?: string; tipo?: string; [k: string]: unknown };

function adicionar<K, V>(mapa: Map<K, V[]>, k: K, v: V): void {
  const l = mapa.get(k);
  if (l) l.push(v);
  else mapa.set(k, [v]);
}

const MIN_ITENS_COPIA = 8;
const SIMILARIDADE_COPIA = 0.9;

export class IndiceBase {
  readonly leituras_por_documento = new Map<string, { pdf: any; valor: Moeda }[]>();
  readonly pdfs_externos: Record<string, InfoPdfExterno>;
  readonly por_pdf = new Map<string, Pagina[]>();
  readonly pdfs_com_leitura: Set<string>;
  readonly pdf_termo = new Map<string, boolean>();
  readonly acessorio = new Map<string, boolean>();
  readonly tambem_lastro = new Map<string, boolean>();
  readonly idx_corrido = new Map<string, number[]>();
  readonly idx_grupos = new Map<string, number[]>();
  readonly idx_principal = new Map<string, number[]>();
  readonly idx_moeda = new Map<string, number[]>();
  readonly idx_pessoa = new Map<string, number[]>();
  readonly idx_codigo = new Map<string, number[]>();
  aprendizado: Aprendizado | null = null;
  private _conteudos = new Map<string, Set<string>>();
  private _pessoasDoPdf = new Map<string, Set<string>>();
  private _amostraNoPdf = new Map<string, boolean>();
  private _extrasTermo = new Map<string, [Obj, number]>();
  private _pdfsQueServem = new Map<string, string[]>();
  private _copias = new Map<string, boolean>();
  private _idxFinal: Map<string, number[]> | null = null;
  private _idxPalavra: Map<string, Set<number>> | null = null;

  constructor(
    readonly paginas: Pagina[],
    tiposPdf: Record<string, boolean> | Map<string, boolean> | null = null,
    pdfsComLeitura: Iterable<string> | null = null,
    pdfsExternos: Record<string, InfoPdfExterno> | null = null,
    leituras: { pdf?: any; documento?: any; valor?: any }[] | null = null,
    pdfsComLastro: Iterable<string> | null = null,
  ) {
    for (const leitura of leituras ?? []) {
      const doc = normalizarPessoa(leitura.documento);
      const valor = normalizarMoeda(leitura.valor);
      if (doc && valor) adicionar(this.leituras_por_documento, doc, { pdf: leitura.pdf ?? null, valor });
    }
    this.pdfs_externos = pdfsExternos ?? {};
    for (const pg of paginas) adicionar(this.por_pdf, pg.pdf, pg);
    for (const [pdf, lista] of this.por_pdf) this.por_pdf.set(pdf, ordenar(lista, (pg) => [pg.numero]));
    this.pdfs_com_leitura = new Set(pdfsComLeitura ?? []);
    for (const [pdf, lista] of this.por_pdf) this.acessorio.set(pdf, search(RE_DOCUMENTO_ACESSORIO, [...lista[0].texto].slice(0, 400).join('')) !== null);
    const tipos = tiposPdf instanceof Map ? tiposPdf : new Map(Object.entries(tiposPdf ?? {}));
    for (const [pdf, lista] of this.por_pdf) {
      if (tipos.has(pdf)) {
        this.pdf_termo.set(pdf, !!tipos.get(pdf));
      } else {
        const inicio = lista.slice(0, 3).map((pg) => pg.texto).join(' ');
        this.pdf_termo.set(pdf, PALAVRAS_TERMO.some((p) => inicio.includes(p)));
      }
    }
    const comLastro = new Set(pdfsComLastro ?? []);
    for (const [pdf, lista] of this.por_pdf) {
      this.tambem_lastro.set(pdf, !!this.pdf_termo.get(pdf) && comLastro.has(pdf)
        && search(RE_TERMO_NA_CAPA, [...lista[0].texto].slice(0, 1500).join('')) === null);
    }
    paginas.forEach((pg, i) => {
      for (const [p, gs, corrido] of pg.numeros) {
        const k = ancora(i, p);
        adicionar(this.idx_corrido, corrido, k);
        adicionar(this.idx_grupos, gs.join(','), k);
        adicionar(this.idx_principal, gs[0], k);
      }
      for (const [p, , codigo] of pg.codigos) adicionar(this.idx_codigo, codigo, ancora(i, p));
      for (const [p, v] of pg.moedas) adicionar(this.idx_moeda, v, ancora(i, p));
      for (const [p, v] of pg.pessoas) adicionar(this.idx_pessoa, v, ancora(i, p));
    });
  }

  private conteudo(pdf: string): Set<string> {
    let c = this._conteudos.get(pdf);
    if (!c) {
      c = new Set();
      for (const pg of this.por_pdf.get(pdf) ?? []) {
        for (const [, d] of pg.pessoas) c.add(`p:${d}`);
        for (const [, v] of pg.moedas) c.add(`m:${v}`);
        for (const [, d] of pg.datas) c.add(`d:${d}`);
      }
      this._conteudos.set(pdf, c);
    }
    return c;
  }

  /** CPFs/CNPJs que o PDF traz. */
  pessoasDoPdf(pdf: string): Set<string> {
    let s = this._pessoasDoPdf.get(pdf);
    if (!s) {
      s = new Set();
      for (const pg of this.por_pdf.get(pdf) ?? []) for (const [, d] of pg.pessoas) s.add(d);
      this._pessoasDoPdf.set(pdf, s);
    }
    return s;
  }

  /** amostraNoDocumento com cache por (PDF, campo, valor da amostra). */
  amostraNoPdf(amostra: Amostra, campo: string, pdf: string): boolean {
    const alvo = ALVO_DO_CAMPO[campo];
    const valor = alvo ? (amostra as any)[alvo] ?? null : amostra.documento?.corrido ?? null;
    const chave = JSON.stringify([pdf, campo, valor]);
    let r = this._amostraNoPdf.get(chave);
    if (r === undefined) {
      r = amostraNoDocumento(amostra, campo, this.por_pdf.get(pdf) ?? []);
      this._amostraNoPdf.set(chave, r);
    }
    return r;
  }

  /** avaliarExtrasTermo com cache por (PDF, aquisição, fundo, cedente). */
  extrasTermo(amostra: Amostra, pdf: string): [Obj, number] {
    const chave = JSON.stringify([pdf, amostra.aquisicao, amostra.fundo_doc, amostra.fundo_nome, amostra.cedente_doc, amostra.cedente_nome]);
    let r = this._extrasTermo.get(chave);
    if (!r) {
      r = avaliarExtrasTermo(amostra, this.por_pdf.get(pdf) ?? []);
      this._extrasTermo.set(chave, r);
    }
    const [campos, score] = r;
    return [Object.fromEntries(Object.entries(campos).map(([c, s]) => [c, { ...s }])), score];
  }

  /** O PDF pode ser candidato a `tipo` ('termo' ou 'lastro')? */
  serveComo(pdf: string, tipo: string): boolean {
    if (tipo === 'termo') return !!this.pdf_termo.get(pdf);
    return !this.pdf_termo.get(pdf) || !!this.tambem_lastro.get(pdf);
  }

  pdfsQueServem(tipo: string): string[] {
    let l = this._pdfsQueServem.get(tipo);
    if (!l) {
      l = [...this.por_pdf.keys()].filter((pdf) => !this.acessorio.get(pdf) && this.serveComo(pdf, tipo));
      this._pdfsQueServem.set(tipo, l);
    }
    return l;
  }

  mesmoDocumento(pdfA: string, pdfB: string): boolean {
    const a = this.conteudo(pdfA);
    const b = this.conteudo(pdfB);
    const [menor, maior] = [a.size, b.size].sort((x, y) => x - y);
    if (menor < MIN_ITENS_COPIA || menor < SIMILARIDADE_COPIA * maior) return false;
    const par = compararStr(pdfA, pdfB) < 0 ? `${pdfA}\u0000${pdfB}` : `${pdfB}\u0000${pdfA}`;
    let r = this._copias.get(par);
    if (r === undefined) {
      let inter = 0;
      for (const x of a) if (b.has(x)) inter++;
      r = inter / (a.size + b.size - inter) >= SIMILARIDADE_COPIA;
      this._copias.set(par, r);
    }
    return r;
  }

  private numerosQueTerminamCom(final: string): number[] {
    if (this._idxFinal === null) {
      this._idxFinal = new Map();
      this.paginas.forEach((pg, i) => {
        for (const [p, , corrido] of pg.numeros) {
          for (let tamanho = MIN_DIGITOS_NUMERO_FINAL; tamanho < Math.min(corrido.length, 12); tamanho++) {
            adicionar(this._idxFinal!, corrido.slice(-tamanho), ancora(i, p));
          }
        }
      });
    }
    return this._idxFinal.get(final) ?? [];
  }

  private paginasComPalavra(palavra: string): Set<number> {
    if (this._idxPalavra === null) {
      this._idxPalavra = new Map();
      this.paginas.forEach((pg, i) => {
        for (const p of new Set(split(compactar(pg.texto)))) {
          let s = this._idxPalavra!.get(p);
          if (!s) {
            s = new Set();
            this._idxPalavra!.set(p, s);
          }
          s.add(i);
        }
      });
    }
    return this._idxPalavra.get(palavra) ?? new Set();
  }

  /** Páginas que trazem o nome (75% das palavras, no mínimo 2). Posição: a 1ª palavra achada. */
  ancorasPorNome(tokens: string[]): Set<number> {
    if (tokens.length < 2) return new Set();
    const minimo = Math.max(2, Math.ceil(0.75 * tokens.length));
    const contagem = new Map<number, number>();
    for (const t of new Set(tokens)) for (const i of this.paginasComPalavra(t)) contagem.set(i, (contagem.get(i) ?? 0) + 1);
    const ancoras = new Set<number>();
    for (const [i, n] of contagem) {
      if (n < minimo) continue;
      const pg = this.paginas[i];
      for (const t of tokens) {
        const m = search(re(`(?<![a-z0-9])${escapar(t)}(?![a-z0-9])`), pg.texto);
        if (m) {
          ancoras.add(ancora(i, m.index));
          break;
        }
      }
    }
    return ancoras;
  }

  /** (página, posição) onde vale a pena avaliar a pendência. */
  ancoras(amostra: Amostra): Set<number> {
    let ancoras = new Set<number>();
    const add = (l: number[] | undefined) => { for (const k of l ?? []) ancoras.add(k); };
    const doc = amostra.documento && !amostra.documento.trivial ? amostra.documento : null;
    if (doc && doc.codigo) add(this.idx_codigo.get(doc.codigo));
    if (doc && doc.corrido.length >= 3) {
      add(this.idx_corrido.get(doc.corrido));
      add(this.idx_grupos.get(doc.grupos.join(',')));
    }
    if (doc && doc.principal.length >= 4) add(this.idx_principal.get(doc.principal));
    if (doc && amostra.perfil.numero_com_parcela) {
      const corrido = doc.corrido;
      for (const corte of [2, 3]) if (corrido.length - corte >= 5) add(this.idx_corrido.get(corrido.slice(0, -corte)));
      for (let tamanho = MIN_DIGITOS_NUMERO_CONTIDO; tamanho < corrido.length - 1; tamanho++) {
        for (let ini = 0; ini < corrido.length - tamanho + 1; ini++) {
          const pedaco = corrido.slice(ini, ini + tamanho);
          if (pedaco[0] !== '0') add(this.idx_corrido.get(pedaco));
        }
      }
      if (corrido.length >= MIN_DIGITOS_NUMERO_FINAL) add(this.numerosQueTerminamCom(corrido));
    }
    if (amostra.sacado_doc) add(this.idx_pessoa.get(amostra.sacado_doc));
    if (amostra.valor !== null) {
      for (const k of this.idx_moeda.get(amostra.valor) ?? []) {
        const pg = this.paginas[paginaDaAncora(k)];
        const datas = new Set(pg.datas.map(([, d]) => d));
        if ((amostra.vencimento !== null && datas.has(amostra.vencimento)) || (amostra.emissao !== null && datas.has(amostra.emissao))
            || (pg.moedas.some(([, v]) => v === amostra.valor) && pg.pessoas.some(([, v]) => v === amostra.sacado_doc))) {
          ancoras.add(k);
        }
      }
    }
    if (!ancoras.size && amostra.perfil.ancora_por_nome) ancoras = this.ancorasPorNome(amostra.sacado_nome);
    return ancoras;
  }
}

function ordenarAncoras(ancoras: Iterable<number>): number[] {
  return [...ancoras].sort((a, b) => a - b);
}

/** Melhor região (página inteira ou linha) de cada PDF candidato. */
function melhorPorPdf(amostra: Amostra, indice: IndiceBase, ancoras: Set<number>, aceitaPdf: (pdf: string) => boolean): Obj[] {
  const melhores = new Map<string, Obj>();
  const porPagina = new Map<number, number[]>();
  for (const k of ordenarAncoras(ancoras)) adicionar(porPagina, paginaDaAncora(k), posDaAncora(k));
  for (const [i, posicoes] of porPagina) {
    const pg = indice.paginas[i];
    if (!aceitaPdf(pg.pdf)) continue;
    const linhas: [number, Obj, [number, number]][] = [];
    let regioes: [number, number][] = [];
    if (pg.ehTabela()) {
      const unicas = new Map<string, [number, number]>();
      for (const p of posicoes) {
        const r = pg.regiaoRegistro(p);
        unicas.set(`${r[0]},${r[1]}`, r);
      }
      regioes = [...unicas.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    }
    for (const [inicio, fim] of regioes) {
      const [camposL, scoreL] = avaliarRegiao(amostra, pg, inicio, fim, true);
      const fortesLinha = CAMPOS_FORTES.filter((c) => camposL[c].valor === 'V').length;
      if (fortesLinha >= 2) linhas.push([scoreL, camposL, [inicio, fim]]);
    }
    let segundoNaPagina = 0;
    let score: number;
    let campos: Obj;
    let regiao: [number, number] | null;
    if (linhas.length) {
      const ordenadas = ordenar(linhas, (c) => [c[0]], true);
      [score, campos, regiao] = ordenadas[0];
      if (ordenadas.length > 1) segundoNaPagina = ordenadas[1][0];
    } else {
      [campos, score] = avaliarRegiao(amostra, pg, 0, pg.texto.length, false);
      regiao = null;
    }
    const atual = melhores.get(pg.pdf);
    if (atual !== undefined && (regiao !== null || atual.regiao !== null)) {
      const perdedor = Math.min(score, atual.score);
      segundoNaPagina = Math.max(segundoNaPagina, perdedor, atual.segundo_no_pdf);
    }
    if (atual === undefined || score > atual.score) {
      const [trechoIni, trechoFim] = regiao ? regiao : trechoEmVolta(pg, posicoes[0]);
      melhores.set(pg.pdf, {
        processed_pdf: pg.pdf,
        pagina: pg.numero,
        score,
        campos,
        trecho: compactarEspacos(pg.texto.slice(trechoIni, trechoFim), 200),
        tem_leitura: indice.pdfs_com_leitura.has(pg.pdf),
        base_externa: indice.pdfs_externos[pg.pdf] ?? null,
        assinatura: pg.texto,
        segundo_no_pdf: segundoNaPagina,
        regiao: regiao ? [pg.numero, regiao[0], regiao[1]] : null,
      });
    } else {
      atual.segundo_no_pdf = Math.max(atual.segundo_no_pdf, segundoNaPagina);
    }
  }
  return ordenar([...melhores.values()], (c) => [c.score], true);
}

function trechoEmVolta(pg: Pagina, pos: number, contexto = 60): [number, number] {
  return [Math.max(0, pos - contexto), Math.min(pg.texto.length, pos + contexto)];
}

function confiancaDe(melhor: Obj, segundo: Obj | null): string {
  const campos = melhor.campos;
  let fortes = CAMPOS_FORTES.filter((c) => campos[c].valor === 'V' && !campos[c].base_vazia).length;
  if (campos.numero_documento.valor === 'V' && campos.sacado_nome.valor === 'V' && campos.sacado_documento.valor !== 'V') fortes += 1;
  const concorrente = Math.max(segundo ? segundo.score : 0, melhor.segundo_no_pdf ?? 0);
  const margem = melhor.score - concorrente;
  const docV = melhor.campos.numero_documento.valor === 'V';
  if (melhor.score < 3.0) return 'sem_candidato';
  if (margem < 1.0) return 'ambigua';
  if (fortes >= 2 && margem >= 2.0 && (docV || melhor.score >= 7.0)) return 'alta';
  if (fortes >= 2 && melhor.score >= 5.0) return 'media';
  return 'baixa';
}

const CANDIDATOS_USADOS = 3;
const CAMPOS_DO_TITULO = ['numero_documento', 'sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento', 'valor_total'];
const CAMPOS_DO_CABECALHO = ['sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento', 'valor_total'];
const CAMPOS_DE_PESSOA = ['sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento'];

function classificarTipo(amostra: Amostra, indice: IndiceBase, ancorasEntrada: Set<number>, tipo: string): Obj | null {
  const aceita = (pdf: string) => {
    if (indice.acessorio.get(pdf)) return false;
    if (tipo === 'termo') return indice.serveComo(pdf, 'termo') || amostra.perfil.titulo_serve_de_termo;
    return indice.serveComo(pdf, 'lastro');
  };
  let ancoras = ancorasEntrada;
  if (tipo === 'lastro') ancoras = new Set([...ancoras].filter((k) => !indice.paginas[paginaDaAncora(k)].ehListagem()));
  let candidatos = melhorPorPdf(amostra, indice, ancoras, aceita);
  if (tipo === 'lastro') {
    for (const c of candidatos) {
      if (c.regiao === null) {
        c.score += conferirNoDocumentoInteiro(amostra, c.campos, indice.por_pdf.get(c.processed_pdf)!);
      } else {
        conferirNoDocumentoInteiro(amostra, c.campos, indice.por_pdf.get(c.processed_pdf)!, CAMPOS_DO_CABECALHO);
      }
    }
  }
  if (tipo === 'termo') {
    for (const c of candidatos) {
      if (c.regiao === null && amostra.perfil.termo_e_o_documento_do_titulo) {
        c.score += conferirNoDocumentoInteiro(amostra, c.campos, indice.por_pdf.get(c.processed_pdf)!);
      } else if (c.regiao !== null) {
        conferirNoDocumentoInteiro(amostra, c.campos, indice.por_pdf.get(c.processed_pdf)!, CAMPOS_DE_PESSOA);
      }
      const [extras, s] = indice.extrasTermo(amostra, c.processed_pdf);
      for (const [campo, status] of Object.entries(extras)) {
        if (CAMPOS_TERMO_EXTRA.includes(campo) || c.campos[campo]?.valor === 'P') c.campos[campo] = status;
      }
      c.score += s;
    }
    candidatos = ordenar(candidatos, (c) => [c.score], true);
  }
  candidatos = ordenar(candidatos, (c) => [-c.score, !c.tem_leitura, c.processed_pdf]);
  const vistos = new Set<string>();
  const unicos: Obj[] = [];
  for (const c of candidatos) {
    if (unicos.length >= CANDIDATOS_USADOS) break;
    if (vistos.has(c.assinatura)) continue;
    if (unicos.some((u) => indice.mesmoDocumento(c.processed_pdf, u.processed_pdf))) continue;
    vistos.add(c.assinatura);
    unicos.push(c);
  }
  candidatos = unicos;
  if (!candidatos.length) return null;
  const melhor = candidatos[0];
  const segundo = candidatos.length > 1 ? candidatos[1] : null;
  let confianca = confiancaDe(melhor, segundo);
  if (tipo === 'termo') confianca = ajustarTermo(amostra, melhor, indice.por_pdf.get(melhor.processed_pdf)!, confianca);
  return {
    ...melhor,
    confianca,
    alternativas: candidatos.slice(1, 3).map((c) => ({
      processed_pdf: c.processed_pdf, pagina: c.pagina, score: c.score, trecho: c.trecho, tem_leitura: c.tem_leitura, regiao: c.regiao,
    })),
  };
}

/** Campo do título que não conferiu na página da âncora confere se aparece no documento. Devolve o score somado. */
export function conferirNoDocumentoInteiro(amostra: Amostra, campos: Obj, paginasPdf: Pagina[], camposAConferir: string[] = CAMPOS_DO_TITULO): number {
  const limite = amostra.perfil.paginas_documento_inteiro;
  const paginas = limite ? paginasPdf.slice(0, limite) : paginasPdf;
  const regioes: [Pagina, number, number][] = paginas.map((pg) => [pg, 0, pg.texto.length]);
  let somado = 0;
  for (const campo of camposAConferir) {
    const status = campos[campo];
    if (status === undefined || status === null || status.valor === 'V') continue;
    let evidencia: Evidencia | null = null;
    let regra: string | null = null;
    if (campo === 'valor_total' && amostra.valor) {
      outer: for (const pg of paginas) {
        for (const [p, v] of pg.moedas) {
          if (v === amostra.valor && !valorDeEncargo(pg.texto, p)) {
            evidencia = trecho(pg, p);
            break outer;
          }
        }
      }
    } else if (campo === 'sacado_documento' && amostra.sacado_doc) {
      [evidencia, regra] = ocorrenciaDaPessoa(paginas, amostra.sacado_doc);
    } else if (campo === 'cedente_documento' && amostra.cedente_doc) {
      [evidencia, regra] = ocorrenciaDaPessoa(paginas, amostra.cedente_doc);
    } else if (campo === 'sacado_nome' || campo === 'cedente_nome') {
      const tokens = campo === 'sacado_nome' ? amostra.sacado_nome : amostra.cedente_nome;
      const [achado] = avaliarNome(campo, tokens, regioes);
      if (achado.valor === 'V') {
        campos[campo] = status.origem ? { ...achado, origem: status.origem } : achado;
        somado += PESOS[campo];
      }
      continue;
    } else if (campo === 'numero_documento' && amostra.documento && !amostra.documento.trivial) {
      let como: string | null = null;
      const codigo = amostra.documento.codigo;
      if (codigo) {
        for (const pg of paginas) {
          const e = pg.codigoEm(codigo);
          if (e) {
            evidencia = e;
            break;
          }
        }
      }
      if (!evidencia) {
        for (const pg of paginas) {
          if (!numeroPodeEstarNaPagina(amostra.documento, pg, amostra.perfil.numero_com_parcela, true)) continue;
          for (const [pos, gs, corrido] of pg.numeros) {
            como = confereNaPagina(amostra.documento, pg, pos, gs, corrido, amostra.perfil.numero_com_parcela);
            if (como) {
              evidencia = trecho(pg, pos);
              break;
            }
          }
          if (evidencia) break;
        }
      }
      if (evidencia) {
        const novo = st('V', null, [evidencia], como === 'parcela' ? 'numero_com_parcela' : null);
        if (status.origem) novo.origem = status.origem;
        campos[campo] = novo;
        somado += PESOS[campo];
      }
      continue;
    }
    if (evidencia) {
      const novo = st('V', null, [evidencia], regra);
      if (status.origem) novo.origem = status.origem;
      campos[campo] = novo;
      somado += PESOS[campo];
    }
  }
  return somado;
}

/** Regras que só valem pro termo de cessão (parcela não conferida, emissão que o termo não traz). */
function ajustarTermo(amostra: Amostra, melhor: Obj, paginasPdf: Pagina[], confiancaEntrada: string): string {
  let confianca = confiancaEntrada;
  const campos = melhor.campos;
  const vencimentoConfere = campos.data_vencimento.valor === 'V' || campos.data_vencimento.regra === 'vencimento_um_dia_antes';
  const aq = campos.data_aquisicao;
  const termoConfirmado = aq && aq.valor === 'V' && aq.evidencias && aq.evidencias.length && !aq.regra;
  const pagina = paginasPdf.find((pg) => pg.numero === melhor.pagina) ?? null;
  const listaTitulos = melhor.regiao !== null || (pagina !== null && pagina.ehTabela());
  const numeroImpresso = campos.numero_documento.valor === 'V' && !!(campos.numero_documento.evidencias && campos.numero_documento.evidencias.length);
  if (amostra.vencimento && !vencimentoConfere && (confianca === 'alta' || confianca === 'media') && listaTitulos && !numeroImpresso) {
    if (termoConfirmado) {
      melhor.aviso = 'parcela_fora_do_indice';
      melhor.regiao = null;
    } else {
      confianca = 'baixa';
    }
  }
  if (amostra.emissao && campos.data_emissao.valor === 'P') {
    const evid = primeiraOcorrencia(paginasPdf, 'datas', amostra.emissao);
    campos.data_emissao = evid ? st('V', null, [evid]) : st('D', '', null, 'ausente_no_documento');
  }
  return confianca;
}

const ORDEM_CONFIANCA: Record<string, number> = { alta: 0, media: 1, baixa: 2, ambigua: 3, sem_candidato: 4 };

// ----------------------------------------------------------------------------
// Documento de emissão (CCB): fonte de verdade das datas
// ----------------------------------------------------------------------------

function vencimentoFinal(inicio: Pagina[]): Achada | null {
  const final = dataApos(inicio, RE_ULTIMA_PARCELA);
  if (final) return final;
  const primeira = dataApos(inicio, RE_PRIMEIRA_PARCELA);
  if (!primeira) return null;
  for (const pg of inicio) {
    const qtd = search(RE_QTD_PARCELAS, pg.texto);
    if (qtd) {
      const calculada = somarMeses(primeira[2], inteiro(qtd[1]) - 1);
      return calculada ? [primeira[0], primeira[1], calculada] : null;
    }
  }
  return null;
}

const PAGINAS_EMISSAO = 5;
const RE_EMISSAO_CLAUSULA = re(`data de emiss${NS}?o d[ao]s?${S}+notas${S}+comerciais${S}+ser${NS}?`);

/** {emissao, vencimento: (pagina, posição, data)} das datas que o documento de emissão traz. */
export function datasDoDocumentoDeEmissao(paginasPdf: Pagina[]): Obj {
  const inicio = paginasPdf.slice(0, 3);
  const emissao = dataApos(paginasPdf.slice(0, PAGINAS_EMISSAO), RE_EMISSAO_CLAUSULA)
    || dataApos(paginasPdf.slice(0, PAGINAS_EMISSAO), ROTULOS.data_emissao);
  if (!emissao) return {};
  const datas: Obj = { emissao, rotulo_emissao: 'Data de Emissão' };
  const vencimento = vencimentoFinal(inicio);
  if (vencimento) {
    datas.vencimento = vencimento;
    datas.rotulo_vencimento = dataApos(inicio, RE_ULTIMA_PARCELA)
      ? 'Vencimento Final' : 'Vencimento calculado (1ª parcela + quantidade de parcelas)';
  }
  return datas;
}

function dataConformeDocumento(esperado: Data | null, vale: Achada, conferem: [Pagina, number, Data, string][] = [],
  regraCorrecao = 'vale_documento_emissao', rotulo: string | null = null): Obj {
  const [pg, pos, dataDoc] = vale;
  const evidencia = [trecho(pg, pos)];
  const fonte = fonteDocumento(pg, rotulo);
  if (esperado === null) return { ...st('D', dataDoc, evidencia, 'planilha_vazia_vale_documento'), fonte };
  if (esperado === dataDoc) return { ...st('V', null, evidencia), fonte };
  for (const [outraPg, outraPos, outraData, regra] of conferem) {
    if (esperado === outraData) return { ...st('V', null, [trecho(outraPg, outraPos)], regra), fonte: fonteDocumento(outraPg) };
  }
  if (datasAntesDoVencimento(esperado).includes(dataDoc)) return { ...st('D', dataDoc, evidencia, 'planilha_um_dia_depois'), fonte };
  return { ...st('D', dataDoc, evidencia, regraCorrecao), fonte };
}

function vencimentoConformeContrato(esperado: Data | null, datas: Obj, inicio: Pagina[], paginasPdf: Pagina[] = []): Obj {
  const final: Achada = datas.vencimento;
  if (esperado !== null) {
    for (const pg of inicio) {
      const cronograma = parcelaNoCronograma(pg, 0, pg.texto.length, esperado);
      if (cronograma) return { ...st('V', null, cronograma), fonte: fonteDocumento(pg, 'Cronograma de parcelas') };
    }
    const tabela = parcelaNaTabela(paginasPdf, esperado);
    if (tabela) {
      const pg = paginasPdf.find((p) => p.numero === tabela[0])!;
      return { ...st('V', null, [tabela], 'parcela_na_tabela'), fonte: fonteDocumento(pg, 'Tabela de parcelas') };
    }
    if (esperado === final[2]) return { ...st('V', null, [trecho(final[0], final[1])]), fonte: fonteDocumento(final[0], datas.rotulo_vencimento) };
    for (const dataParcela of datasAntesDoVencimento(esperado)) {
      for (const pg of inicio) {
        const cronograma = parcelaNoCronograma(pg, 0, pg.texto.length, dataParcela);
        if (cronograma || dataParcela === final[2]) {
          const evid = cronograma || [trecho(final[0], final[1])];
          return {
            ...st('D', dataParcela, evid, 'planilha_um_dia_depois'),
            fonte: fonteDocumento(cronograma ? pg : final[0], cronograma ? 'Cronograma de parcelas' : datas.rotulo_vencimento),
          };
        }
      }
    }
  }
  return dataConformeDocumento(esperado, final, [], 'vale_documento_emissao', datas.rotulo_vencimento);
}

/** Sobrescreve emissão e vencimento com o que o documento de emissão traz. Devolve as evidências usadas. */
function aplicarDocumentoDeEmissao(amostra: Amostra, campos: Obj, paginasPdf: Pagina[]): any[] {
  const datas = datasDoDocumentoDeEmissao(paginasPdf);
  if (!Object.keys(datas).length) return [];
  campos.data_emissao = dataConformeDocumento(amostra.emissao, datas.emissao, [], 'vale_documento_emissao', datas.rotulo_emissao);
  if ('vencimento' in datas) campos.data_vencimento = vencimentoConformeContrato(amostra.vencimento, datas, paginasPdf.slice(0, 3), paginasPdf);
  const saida: any[] = [];
  for (const c of ['data_emissao', 'data_vencimento']) for (const e of campos[c].evidencias ?? []) saida.push([campos[c].valor, ...e]);
  return saida;
}

function evidenciasDoCandidato(campos: Obj): any[] {
  const saida: any[] = [];
  for (const status of Object.values(campos)) {
    if (status.valor !== 'V' && status.valor !== 'D') continue;
    for (const evidencia of status.evidencias ?? []) saida.push([status.valor, ...evidencia]);
  }
  return saida;
}

const CAMPOS_DE_DATA = ['data_emissao', 'data_vencimento', 'data_aquisicao'];

function fontePelaEvidencia(status: Obj, candidatos: Obj): Obj | null {
  if (status.fonte || !(status.evidencias && status.evidencias.length)) return status.fonte ?? null;
  const candidato = candidatos[status.origem || ''] || Object.values(candidatos)[0] || null;
  if (!candidato) return null;
  return { tipo: 'documento', arquivo: candidato.processed_pdf, pagina: status.evidencias[0][0], rotulo: null };
}

const OUTRA_COLUNA_DA_AMOSTRA: Record<string, string> = { data_emissao: 'data_aquisicao', data_aquisicao: 'data_emissao' };
const REGRAS_UM_DIA = new Set(['planilha_um_dia_depois', 'vencimento_um_dia_antes']);
const ALERTAS_INFORMATIVOS = new Set(['data_vencimento', 'data_emissao']);
const NOME_COLUNA_PADRAO: Record<string, string> = {
  data_emissao: 'DATA_EMISSAO', data_aquisicao: 'DATA_AQUISICAO', data_vencimento: 'DATA_VENCIMENTO_ORIGINAL',
};

/** Toda data sugerida diz de onde vem, e vem primordialmente da AMOSTRA. */
function aplicarFontes(amostra: Amostra, campos: Obj, candidatos: Obj): void {
  const valores: Obj = { data_emissao: amostra.emissao, data_vencimento: amostra.vencimento, data_aquisicao: amostra.aquisicao };
  for (const campo of CAMPOS_DE_DATA) {
    const status = campos[campo];
    if (status === undefined || status === null) continue;
    if (CAMPOS_TERMO_EXTRA.includes(campo) && !('termo' in candidatos)) continue;
    const fonteDoc = fontePelaEvidencia(status, candidatos);
    const fonteAmostra = amostra.fontes[campo] || { tipo: 'amostra', coluna: null, motivo: null };
    if (valores[campo] !== null && status.valor === 'D' && REGRAS_UM_DIA.has(status.regra)) {
      if (status.regra === 'vencimento_um_dia_antes' || campo === 'data_emissao') {
        campos[campo] = {
          ...st('V'), fonte: fonteAmostra, origem: status.origem ?? null, evidencias: status.evidencias ?? null, regra: status.regra,
          confirmado_por: fonteDoc, data_documento: status.encontrado ?? null,
        };
      } else {
        campos[campo] = { ...status, fonte: fonteDoc };
      }
      continue;
    }
    if (valores[campo] !== null) {
      const novo: Obj = { ...st('V'), fonte: fonteAmostra, origem: status.origem ?? null, evidencias: status.evidencias ?? null };
      if (status.valor === 'V') {
        novo.confirmado_por = fonteDoc;
        novo.regra = status.regra ?? null;
      } else if (status.valor === 'D' && status.encontrado) {
        novo.alerta = { encontrado: status.encontrado, fonte: fonteDoc, regra: status.regra ?? null, informativo: ALERTAS_INFORMATIVOS.has(campo) };
      } else if (status.valor === 'P' || (status.valor === 'D' && status.encontrado === '')) {
        novo.regra = 'data_so_na_amostra';
      }
      campos[campo] = novo;
      continue;
    }
    if (amostra.nao_enviados.has(campo)) {
      campos[campo] = {
        ...st('V', null, null, 'nao_enviado_pela_administradora'), origem: status.origem ?? null,
        fonte: { tipo: 'amostra', coluna: NOME_COLUNA_PADRAO[campo] ?? null, motivo: `a administradora (${amostra.administradora || 'do fundo'}) não manda essa coluna` },
      };
      continue;
    }
    const outra = OUTRA_COLUNA_DA_AMOSTRA[campo];
    if (outra && valores[outra] !== null) {
      const fonteOutra: Obj = { ...(amostra.fontes[outra] || { tipo: 'amostra', coluna: null }) };
      fonteOutra.coluna = fonteOutra.coluna || NOME_COLUNA_PADRAO[outra];
      fonteOutra.motivo = `${NOME_COLUNA_PADRAO[campo]} vazia na amostra`;
      const novo: Obj = { ...st('D', valores[outra], status.evidencias ?? null, 'amostra_outra_coluna'), fonte: fonteOutra, origem: status.origem ?? null };
      if (status.encontrado === valores[outra] || status.valor === 'V') novo.confirmado_por = fonteDoc;
      campos[campo] = novo;
      continue;
    }
    if (status.valor === 'V' || status.valor === 'D') campos[campo] = { ...status, fonte: fonteDoc };
  }
}

function conferirNumeroDocumento(amostra: Amostra, campos: Obj, indice: IndiceBase, candidatos: Obj): void {
  const status = campos.numero_documento;
  const chaves = amostra.documento;
  if (status === undefined || status === null || status.valor !== 'P' || !chaves) return;
  if (!chaves.trivial) {
    if (chaves.codigo) {
      for (const [tipo, candidato] of Object.entries(candidatos)) {
        for (const pg of indice.por_pdf.get(candidato.processed_pdf) ?? []) {
          const evidencia = pg.codigoEm(chaves.codigo);
          if (evidencia) {
            campos.numero_documento = { ...st('V', null, [evidencia]), fonte: fonteDocumento(pg), origem: tipo };
            return;
          }
        }
      }
    }
    for (const [tipo, candidato] of Object.entries(candidatos)) {
      for (const pg of indice.por_pdf.get(candidato.processed_pdf) ?? []) {
        for (const [pos, gs, corrido] of pg.numeros) {
          const como = confereNaPagina(chaves, pg, pos, gs, corrido, amostra.perfil.numero_com_parcela);
          if (como) {
            campos.numero_documento = { ...statusNumero(pg, pos, como), fonte: fonteDocumento(pg), origem: tipo };
            return;
          }
        }
      }
    }
  }
  campos.numero_documento = { ...st('D', '', null, 'ausente_no_documento'), origem: status.origem ?? null };
}

/** Campo que o documento não traz: vale o que o time marca nesse tipo de recebível e de documento. */
function aplicarConvencoes(amostra: Amostra, campos: Obj, candidatos: Obj): void {
  const documentoDoTitulo = amostra.tipos.has('lastro') ? 'lastro' : 'termo';
  for (const [campo, status] of Object.entries(campos)) {
    if (campo === 'valor_total') continue;
    const documento = CAMPOS_TERMO_EXTRA.includes(campo) ? 'termo' : documentoDoTitulo;
    if (!identificado(candidatos[documento])) continue;
    const semValorNoDocumento = status.valor === 'P' || (status.valor === 'D' && status.encontrado === '' && status.regra === 'ausente_no_documento');
    if (!semValorNoDocumento || !amostra.temValor(campo)) continue;
    const convencao = amostra.perfil.convencao(documento, campo);
    if (convencao === 'V') {
      campos[campo] = { ...st('V', null, null, 'nao_consta_no_documento'), origem: status.origem ?? null };
    } else if (convencao === 'D' && status.valor === 'P') {
      campos[campo] = { ...st('D', '', null, 'ausente_no_documento'), origem: status.origem ?? null };
    }
  }
}

const TOLERANCIA_VALOR_PROXIMO = BigInt(5);

/** Formas de imprimir o valor (ordem fixa: o Python itera um set, de ordem arbitrária). */
function variantesValor(valor: Moeda): string[] {
  const [inteiroTxt, cent] = partesDaMoeda(valor);
  const milhar = comMilhar(inteiroTxt);
  const variantes = [`${milhar.replace(/,/g, '.')},${cent}`, `${inteiroTxt},${cent}`, `${milhar}.${cent}`, `${inteiroTxt}.${cent}`];
  if (cent.endsWith('0')) variantes.push(`${milhar.replace(/,/g, '.')},${cent[0]}`, `${inteiroTxt},${cent[0]}`);
  return [...new Set(variantes)];
}

function comMilhar(inteiroTxt: string): string {
  const grupos: string[] = [];
  for (let fim = inteiroTxt.length; fim > 0; fim -= 3) grupos.unshift(inteiroTxt.slice(Math.max(0, fim - 3), fim));
  return grupos.join(',');
}

const RE_ENCARGO_ANTES = re(
  `(?:iof|seguro|tarifa|juros|multa|mora|cet|custo${S}+efetivo|taxa|desconto|abatimento)[^${D}\\n]{0,25}(?=\\n?$)`);
const RE_VALOR_DA_PARCELA = re(`valor${S}+d[ao]s?${S}+parcelas?`);

/** O valor em `pos` vem logo depois de um encargo (IOF, seguro...)? */
function valorDeEncargo(texto: string, pos: number): boolean {
  const antes = texto.slice(Math.max(0, pos - 40), pos);
  if (search(RE_VALOR_DA_PARCELA, antes)) return false;
  return search(RE_ENCARGO_ANTES, antes) !== null;
}

function valorNoTrecho(pagina: Pagina, inicio: number, fim: number, valor: Moeda): number | null {
  for (const [pos, v] of pagina.moedas) if (inicio <= pos && pos < fim && v === valor && !valorDeEncargo(pagina.texto, pos)) return pos;
  const trechoTxt = pagina.texto.slice(inicio, fim);
  for (const variante of variantesValor(valor)) {
    if (!trechoTxt.includes(variante)) continue;
    for (const m of finditer(re(`(?<![${D}.,])${escapar(variante)}(?![${D}])`), trechoTxt)) {
      if (!valorDeEncargo(pagina.texto, inicio + m.index)) return inicio + m.index;
    }
  }
  return null;
}

const RE_QTD_IMPRESSA = re(
  `(?:quantidade|qtde?\\.?|n[uº°o]\\.?(?:mero)?)${S}+de${S}+parcelas${S}*:?${S}*(${D}{1,3})`
  + `|(?<![${D}.,])(${D}{1,3})${S}*(?:\\([a-z ]+\\)${S}*)?(?:parcelas|prestacoes|vezes)${B}`
  + `|(?<![${D}.,])(${D}{1,3})${S}*x(?![a-z0-9])`);

function quantidadesDeParcelas(pagina: Pagina, inicio: number, fim: number): Set<number> {
  if (!pagina._qtdParcelas) {
    pagina._qtdParcelas = [];
    for (const m of finditer(RE_QTD_IMPRESSA, pagina.texto)) {
      for (const n of [m[1], m[2], m[3]]) {
        if (n && inteiro(n) >= 2 && inteiro(n) <= 420) pagina._qtdParcelas.push([m.index, inteiro(n)]);
      }
    }
  }
  return new Set(pagina._qtdParcelas.filter(([p]) => inicio <= p && p < fim).map(([, q]) => q));
}

type Regiao = [string, Pagina, number, number];

function valorCheioDividido(regioes: Regiao[], valor: Moeda): [Pagina, number, number] | null {
  const qtdPorPdf = new Map<string, Set<number>>();
  for (const [, pg, inicio, fim] of regioes) {
    const s = qtdPorPdf.get(pg.pdf) ?? new Set<number>();
    for (const q of quantidadesDeParcelas(pg, inicio, fim)) s.add(q);
    qtdPorPdf.set(pg.pdf, s);
  }
  const alvo = centavos(valor);
  for (const [, pg, inicio, fim] of regioes) {
    for (const qtd of [...(qtdPorPdf.get(pg.pdf) ?? [])].sort((a, b) => a - b)) {
      const q = BigInt(qtd);
      for (const [pos, cheio] of pg.moedas) {
        if (!(inicio <= pos && pos < fim)) continue;
        const c = centavos(cheio);
        let dif = c - alvo * q;
        if (dif < BigInt(0)) dif = -dif;
        if (c > alvo && dif <= q && !valorDeEncargo(pg.texto, pos)) return [pg, pos, qtd];
      }
    }
  }
  return null;
}

/** [(origem, página, início, fim)] onde o valor do título pode estar, do mais ao menos direto. */
function regioesDoTitulo(amostra: Amostra, indice: IndiceBase, candidatos: Obj, ancoras: Set<number> | null = null): Regiao[] {
  const regioes: Regiao[] = [];
  const vistos = new Set<string>();
  const documentoInteiro = (origem: string, pdf: string) => {
    if (vistos.has(`${pdf}\u0000None`)) return;
    vistos.add(`${pdf}\u0000None`);
    for (const pg of indice.por_pdf.get(pdf) ?? []) regioes.push([origem, pg, 0, pg.texto.length]);
  };
  for (const [tipo, candidato] of Object.entries(candidatos)) {
    const pdf = candidato.processed_pdf;
    const regiao = candidato.regiao;
    const umTitulo = tipo !== 'termo' || amostra.perfil.termo_e_o_documento_do_titulo;
    if (umTitulo) {
      documentoInteiro(tipo, pdf);
    } else if (regiao) {
      vistos.add(`${pdf}\u0000${regiao[0]}:${regiao[1]}`);
      for (const pg of indice.por_pdf.get(pdf) ?? []) if (pg.numero === regiao[0]) regioes.push([tipo, pg, regiao[1], regiao[2]]);
    }
  }
  const codigo = amostra.documento ? amostra.documento.codigo : null;
  const trazONumero = (pdf: string) => {
    if (codigo && (indice.por_pdf.get(pdf) ?? []).some((pg) => pg.codigoEm(codigo))) return true;
    return !!amostra.documento && !amostra.documento.trivial
      && numeroNoDocumento(amostra.documento, indice.por_pdf.get(pdf) ?? [], amostra.perfil.numero_com_parcela);
  };
  for (const k of ordenarAncoras(ancoras ?? indice.ancoras(amostra))) {
    const pos = posDaAncora(k);
    const pg = indice.paginas[paginaDaAncora(k)];
    const variosTitulos = !!indice.pdf_termo.get(pg.pdf) || pg.ehTabela();
    if (!variosTitulos || (indice.pdf_termo.get(pg.pdf) && amostra.perfil.termo_e_o_documento_do_titulo)) {
      if (!vistos.has(`${pg.pdf}\u0000None`) && trazONumero(pg.pdf)) documentoInteiro('relacionado', pg.pdf);
      continue;
    }
    const [ini, fim] = pg.regiaoRegistro(pos);
    const chave = `${pg.pdf}\u0000${pg.numero}:${ini}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const doSacado = !!amostra.sacado_doc && pg.pessoas.some(([p, v]) => ini <= p && p < fim && v === amostra.sacado_doc);
    const identifica = (doSacado && amostra.vencimento !== null && em(pg.datas, ini, fim).includes(amostra.vencimento))
      || (codigo !== null && pg.codigoEm(codigo, ini, fim) !== null)
      || (!!amostra.documento && !amostra.documento.trivial
        && pg.numeros.some(([p, g, c]) => ini <= p && p < fim && numeroConfere(amostra.documento!, g, c, amostra.perfil.numero_com_parcela) !== null));
    if (identifica) regioes.push(['relacionado', pg, ini, fim]);
  }
  return regioes;
}

const JANELA_NOME_DO_CPF = 250;
const MIN_FRACAO_NOME_COM_CPF = 0.5;

/** Nome que não conferiu inteiro, com o CPF achado: confere se metade das palavras está perto do CPF. */
function conferirNomePeloCpf(amostra: Amostra, campos: Obj, indice: IndiceBase, candidatos: Obj): void {
  const status = campos.sacado_nome;
  const doc = campos.sacado_documento;
  const tokens = amostra.sacado_nome;
  if (!status || status.valor === 'V' || !tokens.length || !doc || doc.valor !== 'V') return;
  const candidato = candidatos[doc.origem] || candidatos[status.origem];
  if (!candidato) return;
  const paginas = new Map((indice.por_pdf.get(candidato.processed_pdf) ?? []).map((pg) => [pg.numero, pg]));
  for (const evidencia of doc.evidencias ?? []) {
    if (evidencia.length !== 3 || !paginas.has(evidencia[0])) continue;
    const pg = paginas.get(evidencia[0])!;
    const pos = evidencia[1];
    const ini = Math.max(0, pos - JANELA_NOME_DO_CPF);
    const fim = pos + JANELA_NOME_DO_CPF;
    const achados: Evidencia[] = [];
    for (const t of tokens) {
      const m = search(regexDaPalavra(t), pg.texto, ini, fim);
      if (m) achados.push([pg.numero, m.index, m.index + m[0].length]);
    }
    if (achados.length / tokens.length >= MIN_FRACAO_NOME_COM_CPF) {
      campos.sacado_nome = { ...st('V', null, achados, 'nome_parcial_com_cpf'), origem: status.origem ?? null };
      return;
    }
  }
}

/** Valor da amostra confere se estiver em ALGUM documento do título; senão P com o registro da busca. */
function conferirValorNosDocumentos(amostra: Amostra, campos: Obj, indice: IndiceBase, candidatos: Obj, ancoras: Set<number> | null = null): void {
  const status = campos.valor_total;
  if (status === undefined || status === null || amostra.valor === null) return;
  if (status.valor === 'V' && status.evidencias && status.evidencias.length) return;
  const regioes = regioesDoTitulo(amostra, indice, candidatos, ancoras);
  let proximo: Obj | null = null;
  const alvo = centavos(amostra.valor);
  for (const [origem, pg, inicio, fim] of regioes) {
    const pos = valorNoTrecho(pg, inicio, fim, amostra.valor);
    if (pos !== null) {
      const evidencia = trecho(pg, pos);
      const fonte = fonteDocumento(pg, origem in candidatos ? null : 'Outro documento do título');
      campos.valor_total = { ...st('V', null, [evidencia]), fonte, origem: origem in candidatos ? origem : status.origem ?? null };
      if (origem in candidatos) candidatos[origem].evidencias = [...(candidatos[origem].evidencias ?? []), ['V', ...evidencia]];
      return;
    }
    if (proximo === null) {
      const perto: [bigint, Moeda, Pagina][] = [];
      for (const [p, v] of pg.moedas) {
        if (!(inicio <= p && p < fim)) continue;
        let dif = centavos(v) - alvo;
        if (dif < BigInt(0)) dif = -dif;
        if (dif <= TOLERANCIA_VALOR_PROXIMO) perto.push([dif, v, pg]);
      }
      if (perto.length) {
        let melhor = perto[0];
        for (const t of perto) if (t[0] < melhor[0]) melhor = t;
        proximo = { valor: melhor[1], arquivo: melhor[2].pdf, pagina: melhor[2].numero };
      }
    }
  }
  const cheio = valorCheioDividido(regioes, amostra.valor);
  if (cheio) {
    const [pg, pos, qtd] = cheio;
    campos.valor_total = {
      ...st('V', null, [trecho(pg, pos)], 'valor_cheio_dividido'), origem: status.origem ?? null, parcelas: qtd,
      fonte: fonteDocumento(pg, `Valor cheio ÷ ${qtd} parcelas`),
    };
    return;
  }
  const leituras = amostra.sacado_doc ? indice.leituras_por_documento.get(amostra.sacado_doc) ?? [] : [];
  for (const leitura of leituras) {
    if (leitura.valor === amostra.valor) {
      campos.valor_total = {
        ...st('V', null, null, 'valor_na_leitura_ia'), origem: status.origem ?? null,
        fonte: {
          tipo: 'documento', arquivo: leitura.pdf, pagina: null,
          rotulo: !(indice.por_pdf.get(leitura.pdf) ?? []).length ? 'Leitura da IA (PDF sem texto indexado)' : 'Leitura da IA',
        },
      };
      return;
    }
  }
  if (amostra.valor_pela_amostra) {
    campos.valor_total = {
      ...st('V', null, null, 'valor_pela_amostra'), origem: status.origem ?? null,
      fonte: { tipo: 'amostra', coluna: 'VALOR_NOMINAL', motivo: null },
    };
    return;
  }
  campos.valor_total = {
    ...st('P'), origem: status.origem ?? null, busca: {
      documentos: new Set(regioes.map(([, pg]) => pg.pdf)).size,
      paginas: new Set(regioes.map(([, pg]) => `${pg.pdf}\u0000${pg.numero}`)).size,
      leituras_ia: leituras.length,
      proximo,
    },
  };
}

/** Sugestão de PDF e de V/D/P pra uma pendência (Termo, Lastro ou ambos). */
export function classificarPendencia(amostra: Amostra, indice: IndiceBase): Obj {
  const ancoras = indice.ancoras(amostra);
  const porTipo: Obj = {};
  for (const tipo of [...amostra.tipos].sort()) {
    const resultado = classificarTipo(amostra, indice, ancoras, tipo);
    if (resultado) porTipo[tipo] = resultado;
  }
  let lastro = porTipo.lastro;
  if (lastro && !documentoDoSacado(amostra, indice, lastro.processed_pdf)) delete porTipo.lastro;
  let termo = porTipo.termo;
  lastro = porTipo.lastro;
  if (termo && (termo.confianca === 'baixa' || termo.confianca === 'ambigua')
      && lastro && (lastro.confianca === 'alta' || lastro.confianca === 'media')
      && lastro.campos.numero_documento?.valor === 'V'
      && termoDeOutroTitulo(amostra, indice, termo)) {
    delete porTipo.termo;
  }
  if (amostra.tipos.has('termo') && !('termo' in porTipo)) {
    const ccb = porTipo.lastro || classificarTipo(amostra, indice, ancoras, 'lastro');
    if (ccb && (ccb.confianca === 'alta' || ccb.confianca === 'media')) {
      const comoTermo = ccbComoTermo(amostra, indice, ccb);
      if (comoTermo) porTipo.termo = comoTermo;
    }
  }
  for (const [tipoDoc, doc] of Object.entries(porTipo)) {
    const camposDoc = doc.campos;
    if (tipoDoc === 'lastro' && (doc.confianca === 'alta' || doc.confianca === 'media')
        && amostra.sacado_doc && amostra.sacado_doc.length === 11
        && amostra.sacado_nome.length
        && camposDoc.sacado_documento?.valor !== 'V'
        && camposDoc.sacado_nome?.valor !== 'V'
        && trazCpfDeOutraPessoa(indice.por_pdf.get(doc.processed_pdf) ?? [], amostra.sacado_doc)) {
      doc.confianca = 'baixa';
      doc.aviso = doc.aviso || 'cpf_de_outra_pessoa';
    }
  }
  termo = porTipo.termo;
  lastro = porTipo.lastro;
  const lastroFraco = !!(termo && lastro && termo.confianca === 'alta'
    && lastro.confianca === 'ambigua' && !lastro.aviso
    && !soAPessoa(amostra, indice, lastro.processed_pdf));
  if (lastroFraco) delete porTipo.lastro;
  const aprendizado = indice.aprendizado;
  if (aprendizado) {
    const faltam = [...amostra.tipos].filter((t) => !(t in porTipo) && !(lastroFraco && t === 'lastro')).sort();
    for (const tipo of faltam) {
      const lote = documentoDoLote(amostra, indice, tipo, aprendizado);
      if (lote) porTipo[tipo] = lote;
    }
  }

  const ehTermo = amostra.tipos.has('termo');
  const camposEsperados = [...CAMPOS_LASTRO, ...(ehTermo ? CAMPOS_TERMO_EXTRA : [])];
  if (!Object.keys(porTipo).length) {
    const campos: Obj = Object.fromEntries(camposEsperados.map((c) => [c, st('P')]));
    termoAusentePelaAmostra(amostra, campos, {});
    return { registro_base_id: amostra.registro_base_id, confianca: 'sem_candidato', candidatos: {}, campos };
  }

  const tipoPrincipal = 'lastro' in porTipo ? 'lastro' : 'termo';
  const principal = porTipo[tipoPrincipal];
  const campos: Obj = {};
  for (const c of CAMPOS_LASTRO) campos[c] = { ...(principal.campos[c] ?? st('P')), origem: tipoPrincipal };
  if (ehTermo) {
    const tipoExtra = 'termo' in porTipo ? 'termo' : tipoPrincipal;
    for (const c of CAMPOS_TERMO_EXTRA) campos[c] = { ...(porTipo[tipoExtra].campos[c] ?? st('P')), origem: tipoExtra };
  }
  let confianca = '';
  for (const r of Object.values(porTipo)) if (!confianca || ORDEM_CONFIANCA[r.confianca] > ORDEM_CONFIANCA[confianca]) confianca = r.confianca;
  const candidatos: Obj = {};
  for (const [tipo, r] of Object.entries(porTipo)) {
    let evidencias = evidenciasDoCandidato(r.campos);
    if (r.aviso === 'parcela_fora_do_indice') evidencias = evidencias.filter((e) => e[1] !== r.pagina);
    candidatos[tipo] = {
      processed_pdf: r.processed_pdf, pagina: r.pagina, score: r.score, trecho: r.trecho, tem_leitura: r.tem_leitura,
      confianca: r.confianca, alternativas: r.alternativas, regiao: r.regiao,
      evidencias,
      aviso: r.aviso ?? null,
      base_externa: r.base_externa ?? null,
      regra: r.regra ?? null,
    };
  }
  if ('lastro' in candidatos && !candidatos.lastro.aviso && soAPessoa(amostra, indice, candidatos.lastro.processed_pdf)) {
    candidatos.lastro.aviso = 'so_a_pessoa';
  }

  let referencia = porTipo.lastro ?? null;
  if (referencia === null) {
    referencia = classificarTipo(amostra, indice, ancoras, 'lastro');
    if (referencia && !documentoDoSacado(amostra, indice, referencia.processed_pdf)) referencia = null;
  }
  if (referencia === null && amostra.perfil.termo_e_o_documento_do_titulo && (porTipo.termo?.regiao ?? null) === null) {
    referencia = porTipo.termo ?? null;
  }
  if (referencia && (referencia.confianca === 'alta' || referencia.confianca === 'media')) {
    const paginasReferencia = indice.por_pdf.get(referencia.processed_pdf)!;
    const evidencias = aplicarDocumentoDeEmissao(amostra, campos, paginasReferencia);
    if (!('lastro' in porTipo)) {
      const antes = Object.fromEntries(CAMPOS_DO_TITULO.map((c) => [c, campos[c].valor]));
      conferirNoDocumentoInteiro(amostra, campos, paginasReferencia);
      for (const c of CAMPOS_DO_TITULO) {
        if (antes[c] !== 'V' && campos[c].valor === 'V') {
          campos[c].origem = 'referencia';
          for (const e of campos[c].evidencias ?? []) evidencias.push(['V', ...e]);
        }
      }
    }
    for (const c of ['data_emissao', 'data_vencimento']) campos[c].origem = 'lastro' in porTipo ? 'lastro' : 'referencia';
    if (evidencias.length && 'lastro' in candidatos) {
      candidatos.lastro.evidencias.push(...evidencias);
    } else if (evidencias.length) {
      candidatos.referencia = {
        processed_pdf: referencia.processed_pdf, pagina: referencia.pagina, score: referencia.score, trecho: referencia.trecho,
        tem_leitura: referencia.tem_leitura, confianca: referencia.confianca,
        regiao: null, alternativas: [], evidencias,
      };
    }
  }

  conferirNumeroDocumento(amostra, campos, indice, candidatos);
  aplicarFontes(amostra, campos, candidatos);
  aplicarConvencoes(amostra, campos, candidatos);
  conferirValorNosDocumentos(amostra, campos, indice, candidatos, ancoras);
  conferirNomePeloCpf(amostra, campos, indice, candidatos);
  termoAusentePelaAmostra(amostra, campos, candidatos);
  aplicarConvencoesAprendidas(amostra, campos, candidatos, aprendizado, indice);
  if ('lastro' in porTipo && 'termo' in porTipo) {
    for (const c of CAMPOS_LASTRO) {
      if (campos[c].origem === 'lastro' && campos[c].valor === 'P' && porTipo.termo.campos[c]?.valor === 'V') campos[c].no_termo = true;
    }
  }
  return { registro_base_id: amostra.registro_base_id, confianca, candidatos, campos };
}

/** O termo achado pelo CPF traz, em toda linha desse CPF, OUTRO nº de CCB. */
function termoDeOutroTitulo(amostra: Amostra, indice: IndiceBase, termo: Obj): boolean {
  const chaves = amostra.documento;
  if (!chaves || chaves.trivial || !amostra.sacado_doc) return false;
  if (termo.campos.numero_documento?.valor === 'V') return false;
  let linhas = 0;
  for (const pg of indice.por_pdf.get(termo.processed_pdf) ?? []) {
    const datasEValores = new Set([...pg.datas.map(([p]) => p), ...pg.moedas.map(([p]) => p)]);
    for (const [posDoc, doc] of pg.pessoas) {
      if (doc !== amostra.sacado_doc) continue;
      const [inicio, fim] = pg.regiaoLinha(posDoc);
      const numeros = pg.numeros.filter(([p, , c]) => inicio <= p && p < fim && p !== posDoc && !datasEValores.has(p)
        && c.length >= MIN_DIGITOS_NUMERO_LINHA);
      if (numeros.length !== 1) return false;
      const [pos, gs, corrido] = numeros[0];
      if (confereNaPagina(chaves, pg, pos, gs, corrido, amostra.perfil.numero_com_parcela)) return false;
      linhas += 1;
    }
  }
  return linhas > 0;
}

const RE_CPF_ROTULADO = re(`${B}cpf${B}[^0-9]{0,15}(${D}{3}\\.?${D}{3}\\.?${D}{3}-?${D}{2})`);

const ALVO_DO_CAMPO: Record<string, string> = {
  data_emissao: 'emissao', data_vencimento: 'vencimento', data_aquisicao: 'aquisicao',
  valor_total: 'valor', sacado_documento: 'sacado_doc', cedente_documento: 'cedente_doc',
  doc_cessionario: 'fundo_doc', sacado_nome: 'sacado_nome', cedente_nome: 'cedente_nome',
  nome_cessionario: 'fundo_nome',
};

/** O valor da amostra pra `campo` aparece em alguma página do documento (em qualquer lugar e formato)? */
export function amostraNoDocumento(amostra: Amostra, campo: string, paginasPdf: Pagina[]): boolean {
  if (campo === 'numero_documento') {
    const chaves = amostra.documento;
    if (!chaves || chaves.trivial) return false;
    if (chaves.codigo && paginasPdf.some((pg) => pg.codigoEm(chaves.codigo!))) return true;
    return numeroNoDocumento(chaves, paginasPdf, amostra.perfil.numero_com_parcela);
  }
  const nomeAlvo = ALVO_DO_CAMPO[campo];
  const alvo = nomeAlvo ? (amostra as any)[nomeAlvo] : null;
  if (!alvo || (Array.isArray(alvo) && !alvo.length)) return false;
  if (campo.startsWith('data_')) return paginasPdf.some((pg) => pg.datas.some(([, d]) => d === alvo));
  if (campo === 'valor_total') return paginasPdf.some((pg) => pg.moedas.some(([, v]) => v === alvo));
  if (CAMPOS_DOC_PESSOA.includes(campo)) return paginasPdf.some((pg) => pg.pessoas.some(([, d]) => d === alvo || mesmaRaizCnpj(d, alvo)));
  if (campo === 'doc_cessionario') return paginasPdf.some((pg) => pg.pessoas.some(([, d]) => d === alvo));
  return paginasPdf.some((pg) => (alvo as string[]).every((t) => search(regexDaPalavra(t), pg.texto) !== null));
}

const REGRAS_ACHADO_NO_DOCUMENTO = [null, 'data_do_termo', 'data_assinatura'];
const REGRAS_V_SEM_DOCUMENTO = new Set(['nao_consta_no_documento', 'data_so_na_amostra', 'termo_pela_amostra']);

/** Campo que nenhuma busca achou: o veredito do time nos outros títulos do mesmo layout. */
export function aplicarConvencoesAprendidas(amostra: Amostra, campos: Obj, candidatos: Obj, aprendizado: Aprendizado | null,
  indice: { amostraNoPdf(a: Amostra, campo: string, pdf: string): boolean } | null = null): void {
  const termo = candidatos.termo;
  const termoIdentificado = identificado(termo);
  const convencaoDe = (pdf: string, campo: string, papel: string | null, presente = false): Convencao | null => {
    if (!aprendizado) return null;
    const c = aprendizado.convencao(pdf, campo, { excluir: amostra.registro_base_id, papel, presente });
    return c && c.fonte === 'catalogo' && c.veredito === 'V' ? null : c;
  };
  for (const [campo, status] of Object.entries(campos)) {
    const origem = status.origem ?? null;
    if (origem === 'referencia' && campo !== 'valor_total') {
      if (termo && indice !== null && status.valor === 'V' && amostra.temValor(campo)
          && !indice.amostraNoPdf(amostra, campo, termo.processed_pdf)) {
        const convencao = termoIdentificado ? convencaoDe(termo.processed_pdf, campo, 'termo') : null;
        if (convencao && convencao.veredito === 'D') campos[campo] = statusDaConvencao(convencao, 'termo');
        else if (!convencao && !status.regra) status.sem_confirmacao = 'outro_documento';
      }
      continue;
    }
    const ausente = status.valor === 'P' || ['nao_consta_no_documento', 'ausente_no_documento', 'data_so_na_amostra'].includes(status.regra);
    const achado = status.valor === 'V' && REGRAS_ACHADO_NO_DOCUMENTO.includes(status.regra ?? null)
      && !!(status.evidencias && status.evidencias.length);
    if (!(ausente || achado || status.regra === 'termo_pela_amostra') || !amostra.temValor(campo)) continue;
    const cego = status.valor === 'V' && REGRAS_V_SEM_DOCUMENTO.has(status.regra);
    const candidato = candidatos[origem];
    if (!identificado(candidato)) {
      if (cego) status.sem_confirmacao = 'sem_documento';
      continue;
    }
    let presente = achado;
    if (achado && indice !== null && !indice.amostraNoPdf(amostra, campo, candidato.processed_pdf)) presente = false;
    const papel = origem === 'termo' ? 'termo' : 'lastro';
    const convencao = convencaoDe(candidato.processed_pdf, campo, papel, presente);
    if (convencao && (ausente || convencao.veredito === 'D')) {
      campos[campo] = statusDaConvencao(convencao, origem);
    } else if (!convencao && (cego || (achado && !presente && origem === 'termo' && campo !== 'valor_total' && !status.regra))) {
      status.sem_confirmacao = cego ? 'sem_documento' : 'outro_documento';
    } else if (achado && presente && !convencao && aprendizado && timeDividido(aprendizado.vereditos(
      candidato.processed_pdf, campo, { excluir: amostra.registro_base_id, papel, presente: true }))) {
      status.sem_confirmacao = 'time_dividido';
    }
  }
}

function identificado(candidato: Obj | undefined | null): boolean {
  return !!candidato && candidato.confianca !== 'sem_candidato';
}

const MIN_EXEMPLOS_DIVIDIDO = 5;
const MIN_FRACAO_D_DIVIDIDO = 0.15;

function timeDividido(vereditos: Contador<string>): boolean {
  const total = vereditos.total();
  return total >= MIN_EXEMPLOS_DIVIDIDO && vereditos.get('D') / total >= MIN_FRACAO_D_DIVIDIDO;
}

function statusDaConvencao(convencao: Convencao, origem: string | null): Obj {
  const regra = convencao.fonte === 'catalogo' ? 'convencao_de_outros_fundos' : 'convencao_do_layout';
  return {
    ...st(convencao.veredito, convencao.veredito === 'D' ? '' : null, null, regra),
    origem, convencao: { titulos: convencao.titulos, acordo: convencao.acordo },
  };
}

/** Nada achado pelos dados do título: o documento do lote (layout que o time usa como lote). */
function documentoDoLote(amostra: Amostra, indice: IndiceBase, tipo: string, aprendizado: Aprendizado): Obj | null {
  if (!(amostra.fundo_doc || amostra.fundo_nome.length)) return null;
  if (!aprendizado.eh_layout_de_lote) return null;
  const pontuados: [number, string][] = [];
  for (const pdf of indice.pdfsQueServem(tipo)) {
    if (!aprendizado.eh_layout_de_lote(pdf, amostra.registro_base_id)) continue;
    const pessoas = indice.pessoasDoPdf(pdf);
    if (!((amostra.fundo_doc !== null && pessoas.has(amostra.fundo_doc)) || indice.amostraNoPdf(amostra, 'nome_cessionario', pdf))) continue;
    const temCedente = (!!amostra.cedente_doc && pessoas.has(amostra.cedente_doc))
      || (amostra.cedente_nome.length >= 2 && indice.amostraNoPdf(amostra, 'cedente_nome', pdf));
    const temAquisicao = indice.amostraNoPdf(amostra, 'data_aquisicao', pdf);
    if (!(temCedente || temAquisicao)) continue;
    const pontos = (temAquisicao ? 2 : 0) + (amostra.cedente_doc !== null && pessoas.has(amostra.cedente_doc) ? 1 : 0)
      + (amostra.fundo_doc !== null && pessoas.has(amostra.fundo_doc) ? 1 : 0);
    pontuados.push([pontos, pdf]);
  }
  if (!pontuados.length) return null;
  const ordenados = ordenar(pontuados, (t) => [-t[0], t[1]]);
  const [pontos, pdf] = ordenados[0];
  const paginas = indice.por_pdf.get(pdf)!;
  const primeira = minPor(paginas, (pg) => pg.numero);
  const campos: Obj = Object.fromEntries(CAMPOS_LASTRO.map((c) => [c, st('P')]));
  const [extras] = indice.extrasTermo(amostra, pdf);
  for (const campo of ['cedente_documento', 'cedente_nome']) if (campo in extras) campos[campo] = extras[campo];
  if (tipo === 'termo') for (const campo of CAMPOS_TERMO_EXTRA) campos[campo] = extras[campo] ?? st('P');
  const resumo = (p: string, s: number) => ({
    processed_pdf: p, pagina: minPor(indice.por_pdf.get(p)!, (pg) => pg.numero).numero,
    score: s, trecho: '', tem_leitura: indice.pdfs_com_leitura.has(p), regiao: null,
  });
  const confirmado = aprendizado.pdf_do_lote ? aprendizado.pdf_do_lote(chaveDoLote(amostra), amostra.registro_base_id) === pdf : false;
  return {
    processed_pdf: pdf, pagina: primeira.numero, score: pontos, campos,
    trecho: compactarEspacos([...primeira.texto].slice(0, 300).join(''), 200), tem_leitura: indice.pdfs_com_leitura.has(pdf),
    base_externa: indice.pdfs_externos[pdf] ?? null, assinatura: primeira.texto, segundo_no_pdf: 0,
    regiao: null, confianca: confirmado ? 'alta' : 'baixa',
    regra: confirmado ? 'documento_do_lote_confirmado' : 'documento_do_lote',
    alternativas: ordenados.slice(1, 3).map(([s, p]) => resumo(p, s)),
  };
}

/** (aquisição, cedente) — o que identifica o lote de cessão de um título. */
export function chaveDoLote(amostra: Amostra): ChaveLote {
  const cedente = amostra.cedente_doc || amostra.cedente_nome.join(' ');
  return [amostra.aquisicao, cedente || null];
}

function trazCpfDeOutraPessoa(paginasPdf: Pagina[], cpf: string): boolean {
  const rotulados = new Set<string>();
  for (const pg of paginasPdf) for (const m of finditer(RE_CPF_ROTULADO, pg.texto)) rotulados.add(soDigitos(m[1]));
  return rotulados.size > 0 && !rotulados.has(cpf);
}

/** O documento traz alguma coisa do título: o nº, o CPF/CNPJ do sacado ou metade das palavras do nome. */
function documentoDoSacado(amostra: Amostra, indice: IndiceBase, pdf: string): boolean {
  const paginas = indice.por_pdf.get(pdf) ?? [];
  const doc = amostra.documento;
  const codigo = doc ? doc.codigo : null;
  const cpf = amostra.sacado_doc;
  const tokens = amostra.sacado_nome;
  if (!paginas.length || !(codigo || (doc && !doc.trivial) || cpf || tokens.length)) return true;
  if (codigo && paginas.some((pg) => pg.codigoEm(codigo))) return true;
  const principal = doc && !codigo ? lstrip(doc.principal, '0') : '';
  if (doc && !doc.trivial && paginas.some((pg) => pg.numeros.some(([, g, c]) => numeroConfere(doc, g, c, amostra.perfil.numero_com_parcela) !== null
    || (principal.length >= 4 && c === principal)))) return true;
  if (cpf) for (const p of indice.pessoasDoPdf(pdf)) if (p === cpf || (cpf.length === 14 && mesmaRaizCnpj(p, cpf))) return true;
  if (!tokens.length) return false;
  const achadas = tokens.filter((t) => paginas.some((pg) => search(regexDaPalavra(t), pg.texto) !== null)).length;
  return achadas >= MIN_FRACAO_NOME_COM_CPF * tokens.length;
}

/** O documento traz o devedor mas nada do título — nem o nº, nem o valor, nem o vencimento. */
function soAPessoa(amostra: Amostra, indice: IndiceBase, pdf: string): boolean {
  if (!(indice.por_pdf.get(pdf) ?? []).length) return false;
  const alvos = ['numero_documento', 'valor_total', 'data_vencimento'].filter((c) => amostra.temValor(c));
  if (!alvos.length) return false;
  const codigo = amostra.documento?.codigo;
  if (codigo && indice.por_pdf.get(pdf)!.some((pg) => pg.codigoEm(codigo))) return false;
  return !alvos.some((c) => indice.amostraNoPdf(amostra, c, pdf));
}

function trazOFundo(amostra: Amostra, pg: Pagina): boolean {
  if (amostra.fundo_doc && pg.pessoas.some(([, doc]) => doc === amostra.fundo_doc)) return true;
  return amostra.fundo_nome.length > 0 && amostra.fundo_nome.every((t) => search(regexDaPalavra(t), pg.texto) !== null);
}

/** Pendência de termo sem termo: a CCB com cláusula de cessão/endosso AO FUNDO serve de termo. */
function ccbComoTermo(amostra: Amostra, indice: IndiceBase, ccb: Obj): Obj | null {
  const paginas = indice.por_pdf.get(ccb.processed_pdf) ?? [];
  const clausula = paginas.find((pg) => (pg.texto.includes('endosso') || pg.texto.includes('cessao')) && trazOFundo(amostra, pg));
  if (!clausula) return null;
  const [extras] = avaliarExtrasTermo(amostra, [clausula]);
  const campos: Obj = { ...ccb.campos };
  for (const campo of CAMPOS_TERMO_EXTRA) campos[campo] = extras[campo] ?? st('P');
  const i = clausula.texto.includes('endosso') ? clausula.texto.indexOf('endosso') : clausula.texto.indexOf('cessao');
  return {
    ...ccb, campos, pagina: clausula.numero, regiao: null, alternativas: [],
    trecho: compactarEspacos(clausula.texto.slice(Math.max(0, i - 40), i + 160), 200), regra: 'ccb_como_termo',
  };
}

const COLUNA_AMOSTRA_DO_TERMO: Record<string, string> = {
  data_aquisicao: 'DATA_AQUISICAO', nome_cessionario: 'NOME_FUNDO', doc_cessionario: 'CNPJ_FUNDO',
};

/** Pendência de termo sem termo achado: Data Aquisição e Nome/Doc. Cessionário ficam V com o que a amostra traz. */
function termoAusentePelaAmostra(amostra: Amostra, campos: Obj, candidatos: Obj): void {
  if (!amostra.tipos.has('termo') || 'termo' in candidatos) return;
  for (const [campo, coluna] of Object.entries(COLUNA_AMOSTRA_DO_TERMO)) {
    const status = campos[campo];
    if (status && status.valor === 'P' && amostra.temValor(campo)) {
      const fonte = { ...(amostra.fontes[campo] || { tipo: 'amostra', coluna, motivo: null }) };
      campos[campo] = {
        ...st('V', null, null, 'termo_pela_amostra'), origem: status.origem ?? null,
        fonte: { ...fonte, motivo: 'termo não encontrado' },
      };
    }
  }
}

// ----------------------------------------------------------------------------
// Orquestração
// ----------------------------------------------------------------------------

const PREFIXO_TERMO = 'termo_cessao';

/** TIPO_RECEBIVEL de leitura é termo? (utils/classificacao_recebivel.py) */
export function ehTermoCessao(tipo: unknown): boolean {
  return !!tipo && strip(String(tipo)).toLowerCase().startsWith(PREFIXO_TERMO);
}

/** tipo_documento de um MATCH é termo? ("termo" pelado da tela antiga também.) */
export function ehTermoMatch(tipo: unknown): boolean {
  const valor = strip(String(tipo ?? '')).toLowerCase();
  return valor === 'termo' || valor.startsWith(PREFIXO_TERMO);
}

/** Uma Amostra por registro_base_id, com os tipos (termo/lastro) em aberto. */
export function agruparPendencias(registros: Obj[]): Amostra[] {
  const grupos = new Map<any, [Obj, Set<string>]>();
  for (const r of registros) {
    const rid = r.registro_base_id;
    const tipo = ehTermoCessao(r.tipo_documento) ? 'termo' : 'lastro';
    if (!grupos.has(rid)) grupos.set(rid, [r, new Set()]);
    grupos.get(rid)![1].add(tipo);
  }
  return [...grupos.values()].map(([r, tipos]) => Amostra.deRegistro(r, tipos));
}

const CAMPO_DA_AMOSTRA: Record<string, string> = {
  data_emissao: 'DATA_EMISSAO', data_vencimento: 'DATA_VENCIMENTO_ORIGINAL', data_aquisicao: 'DATA_AQUISICAO',
};

/** Linha da tabela amostra_origem_campo: de qual coluna do Excel veio cada data (registro 0 = a escolhida no upload). */
export type OrigemCampo = { registro_base_id: any; campo: string; coluna_arquivo: string };

function chaveOrigem(rid: any, coluna: string): string {
  return `${String(rid)}\u0000${coluna}`;
}

/** {campo: fonte} da linha: a coluna escolhida no upload ou a que a substituiu nesta linha. */
export function fontesDaAmostra(registroBaseId: any, origens: Map<string, string>): Obj {
  const fontes: Obj = {};
  for (const [campo, colunaBd] of Object.entries(CAMPO_DA_AMOSTRA)) {
    const padrao = origens.get(chaveOrigem(0, colunaBd)) ?? null;
    const naLinha = origens.get(chaveOrigem(registroBaseId, colunaBd)) ?? null;
    if (naLinha) {
      const motivo = padrao ? `a coluna escolhida (${padrao}) estava vazia nesta linha` : 'a coluna escolhida estava vazia nesta linha';
      fontes[campo] = { tipo: 'amostra', coluna: naLinha, motivo };
    } else {
      fontes[campo] = { tipo: 'amostra', coluna: padrao, motivo: null };
    }
  }
  return fontes;
}

/** "Não achado" sai D sem valor (`nao_encontrado`), não P — P é só do analista. */
export function naoEncontradoViraD(resultado: Obj): Obj {
  for (const r of resultado.resultados) {
    const registros = r.registros && r.registros.length ? r.registros : [{}];
    const amostraSemEmissao = !registros[0].base_data_emissao;
    for (const [campo, status] of Object.entries(r.campos as Obj)) {
      if (status.valor === 'P') {
        const regra = campo === 'data_emissao' && amostraSemEmissao ? 'emissao_sem_valor' : 'nao_encontrado';
        r.campos[campo] = { ...status, valor: 'D', encontrado: '', regra };
      }
    }
  }
  return resultado;
}

export type OpcoesNucleo = {
  tiposPdf?: Record<string, boolean> | Map<string, boolean> | null;
  pdfsComLeitura?: Iterable<string> | null;
  origens?: OrigemCampo[] | Map<string, string> | null;
  paginasExternas?: Pagina[] | null;
  pdfsExternos?: Record<string, InfoPdfExterno> | null;
  leituras?: { pdf?: any; documento?: any; valor?: any }[] | null;
  regrasFundo?: RegrasFundo | null;
  aprendizado?: Aprendizado | null;
  pdfsComLastro?: Iterable<string> | null;
};

export function mapaDeOrigens(origens: OrigemCampo[] | Map<string, string> | null | undefined): Map<string, string> {
  if (!origens) return new Map();
  if (origens instanceof Map) return origens;
  return new Map(origens.map((o) => [chaveOrigem(o.registro_base_id, o.campo), o.coluna_arquivo]));
}

/** Núcleo puro (pre_classificar do Python): resumo + uma sugestão por pendência. "Não achado" ainda sai P. */
export function preClassificarNucleo(registrosPendencias: Obj[], paginasBase: Pagina[], opcoes: OpcoesNucleo = {}): Obj {
  const regrasFundo = opcoes.regrasFundo ?? {};
  const paginas = [...paginasBase, ...(opcoes.paginasExternas ?? [])];
  const tipos = new Map<string, boolean>(opcoes.tiposPdf instanceof Map ? opcoes.tiposPdf : Object.entries(opcoes.tiposPdf ?? {}));
  for (const [pdf, info] of Object.entries(opcoes.pdfsExternos ?? {})) tipos.set(pdf, (info.tipo ?? 'termo') === 'termo');
  const indice = new IndiceBase(paginas, tipos, opcoes.pdfsComLeitura ?? null, opcoes.pdfsExternos ?? null, opcoes.leituras ?? null,
    opcoes.pdfsComLastro ?? null);
  indice.aprendizado = opcoes.aprendizado ?? null;
  const origens = mapaDeOrigens(opcoes.origens);
  const porId = new Map<any, Obj[]>();
  for (const r of registrosPendencias) adicionar(porId, r.registro_base_id, r);
  const resultados: Obj[] = [];
  for (const amostra of agruparPendencias(registrosPendencias)) {
    amostra.fontes = fontesDaAmostra(amostra.registro_base_id, origens);
    amostra.nao_enviados = new Set(regrasFundo.nao_enviados ?? []);
    amostra.valor_pela_amostra = !!regrasFundo.valor_pela_amostra;
    amostra.administradora = regrasFundo.administradora || '';
    const resultado = classificarPendencia(amostra, indice);
    resultado.registros = porId.get(amostra.registro_base_id);
    resultados.push(resultado);
  }
  const resumo: Obj = Object.fromEntries(Object.keys(ORDEM_CONFIANCA).map((k) => [k, 0]));
  for (const r of resultados) resumo[r.confianca] += 1;
  return {
    total: resultados.length,
    resumo,
    pdfs_analisados: indice.por_pdf.size,
    paginas_analisadas: paginas.length,
    regras_fundo: regrasFundo,
    resultados,
  };
}

// ----------------------------------------------------------------------------
// Aprendizado com os vínculos já conferidos
// ----------------------------------------------------------------------------

const BASE_DO_CAMPO: Record<string, string> = {
  ...Object.fromEntries(CAMPOS_LASTRO.map((c) => [c, `base_${c}`])),
  data_aquisicao: 'base_data_aquisicao', nome_cessionario: 'base_nome_fundo', doc_cessionario: 'base_cnpj_fundo',
};

function paraComparar(campo: string, valor: unknown): string | null {
  if (vazio(valor)) return null;
  if (['numero_documento', 'sacado_documento', 'cedente_documento', 'doc_cessionario'].includes(campo)) {
    return lstrip(soDigitos(textoDoValor(valor)), '0') || null;
  }
  if (campo === 'valor_total') return normalizarMoeda(valor);
  if (campo.startsWith('data_')) return normalizarData(valor);
  return compactar(textoDoValor(valor)) || null;
}

/** Vínculo conferido antes das marcações por campo: V onde a leitura é igual à amostra. */
export function vereditosPelaLeitura(reg: Obj): Record<string, string> {
  const vereditos: Record<string, string> = {};
  for (const [campo, coluna] of Object.entries(BASE_DO_CAMPO)) {
    const amostra = paraComparar(campo, reg[coluna]);
    if (amostra !== null && amostra === paraComparar(campo, reg[`leitura_${campo}`])) vereditos[campo] = 'V';
  }
  return vereditos;
}

function marcacoesDe(reg: Obj): Record<string, string> | null {
  let m = reg.marcacoes_campos;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      m = null;
    }
  }
  return m && typeof m === 'object' && Object.keys(m).length ? m : null;
}

/** AprendizadoLayout montado com os vínculos já conferidos (linhas no formato de _SQL_VINCULOS_CONFERIDOS). */
export function aprendizadoDaBase(vinculos: Obj[], paginas: Pagina[], catalogo: CatalogoGlobal | null = null): AprendizadoLayout {
  const porPdf = new Map<string, Pagina[]>();
  for (const pg of paginas) adicionar(porPdf, pg.pdf, pg);
  const aprendizado = new AprendizadoLayout(new Map([...porPdf].map(([pdf, pgs]) => [pdf, palavrasDaPrimeiraPagina(pgs)])));
  aprendizado.catalogo = catalogo;
  for (const reg of vinculos) {
    const pgs = porPdf.get(reg.processed_pdf);
    if (!pgs) continue;
    const tipo = ehTermoMatch(reg.tipo_documento) ? 'termo' : 'lastro';
    const amostra = Amostra.deRegistro(reg, [tipo]);
    const traz = ['numero_documento', 'sacado_documento', 'sacado_nome'].some((c) => amostraNoDocumento(amostra, c, pgs));
    aprendizado.observar_vinculo(reg.processed_pdf, reg.registro_base_id, traz, chaveDoLote(amostra));
    for (const [campo, veredito] of Object.entries(marcacoesDe(reg) ?? vereditosPelaLeitura(reg))) {
      if (amostra.temValor(campo)) {
        aprendizado.observar(reg.processed_pdf, campo, veredito, reg.registro_base_id, tipo, amostraNoDocumento(amostra, campo, pgs));
      }
    }
  }
  return aprendizado;
}

// ----------------------------------------------------------------------------
// 2ª passada: lastros de outras bases do fundo
// ----------------------------------------------------------------------------

export const MAX_LASTROS_EXTERNOS = 300;

/** A pendência tem lastro em aberto e nenhum candidato de lastro? */
export function semLastro(resultado: Obj): boolean {
  return !('lastro' in resultado.candidatos) && (resultado.registros ?? []).some((r: Obj) => !ehTermoCessao(r.tipo_documento));
}

/** Padrões (CPF/CNPJ formatado e cru) dos sacados das pendências sem lastro — o `LIKE ANY` do Python. */
export function documentosSemLastro(resultados: Obj[]): string[] {
  const padroes = new Set<string>();
  for (const resultado of resultados) {
    if (!semLastro(resultado)) continue;
    const doc = normalizarPessoa((resultado.registros ?? [])[0]?.base_sacado_documento);
    if (doc) {
      padroes.add(formatarPessoa(doc));
      padroes.add(doc);
    }
  }
  return [...padroes].sort(compararStr);
}

export { MESES, inteiro, ano, mes, dia, somarDias, formatarData, normalizarTexto };
export { PERFIS };
