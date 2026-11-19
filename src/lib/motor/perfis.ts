/**
 * Perfis de leitura por tipo de recebível (backend/services/perfis_recebivel.py)
 * e regras da administradora do fundo (backend/services/regras_fundo.py, só a
 * parte pura — sem banco).
 */
import { ehAlnum, re, split } from './py';
import { normalizarTexto, textoDoValor } from './valores';

// ----------------------------------------------------------------------------
// Família do tipo de recebível
// ----------------------------------------------------------------------------

export function familiaRecebivel(tipoRecebivel: unknown): string {
  const normalizado = normalizarTexto(tipoRecebivel ? textoDoValor(tipoRecebivel) : '');
  let soAlnum = '';
  for (const c of normalizado) soAlnum += ehAlnum(c) ? c : ' ';
  const t = split(soAlnum).join(' ');
  if (t.startsWith('nc ') || t === 'nc' || t.includes('nota comercial')) return 'NOTA COMERCIAL';
  if (t.includes('duplicata') || t.startsWith('dm ')) return 'DUPLICATA';
  if (t.startsWith('ccb')) {
    return ['ccb digital', 'ccb pre digital', 'ccb pre fixado', 'ccb pre balcao'].includes(t) ? t.toUpperCase() : 'CCB OUTRAS';
  }
  if (t.includes('contrato')) return 'CONTRATO';
  if (t.includes('confissao')) return 'CONFISSAO DE DIVIDA';
  if (t.includes('nota de debito')) return 'NOTA DE DEBITO';
  if (t.startsWith('cpr') || t.includes('produto rural') || t.includes('produtor rural')) return 'CPR';
  return 'OUTROS';
}

/**
 * Quando o documento vinculado NÃO traz o valor do campo, o que o time marca
 * (histórico conferido, out/2026). [família, documento, campo, veredito].
 */
export const CONVENCOES: [string, string, string, 'V' | 'D'][] = [
  ['CCB DIGITAL', 'lastro', 'data_vencimento', 'V'],
  ['CCB DIGITAL', 'lastro', 'numero_documento', 'V'],
  ['CCB DIGITAL', 'termo', 'cedente_documento', 'D'],
  ['CCB DIGITAL', 'termo', 'data_aquisicao', 'V'],
  ['CCB DIGITAL', 'termo', 'data_vencimento', 'V'],
  ['CCB DIGITAL', 'termo', 'doc_cessionario', 'D'],
  ['CCB DIGITAL', 'termo', 'numero_documento', 'V'],
  ['CCB DIGITAL', 'termo', 'sacado_documento', 'V'],
  ['CCB DIGITAL', 'termo', 'valor_total', 'V'],
  ['CCB PRE BALCAO', 'lastro', 'data_vencimento', 'V'],
  ['CCB PRE BALCAO', 'lastro', 'numero_documento', 'V'],
  ['CCB PRE BALCAO', 'termo', 'data_aquisicao', 'V'],
  ['CCB PRE BALCAO', 'termo', 'sacado_nome', 'V'],
  ['CCB PRE DIGITAL', 'lastro', 'numero_documento', 'V'],
  ['CCB PRE DIGITAL', 'termo', 'cedente_nome', 'V'],
  ['CCB PRE DIGITAL', 'termo', 'data_aquisicao', 'V'],
  ['CCB PRE DIGITAL', 'termo', 'data_emissao', 'V'],
  ['CCB PRE DIGITAL', 'termo', 'data_vencimento', 'V'],
  ['CCB PRE DIGITAL', 'termo', 'numero_documento', 'V'],
  ['CCB PRE DIGITAL', 'termo', 'valor_total', 'V'],
  ['CCB PRE FIXADO', 'termo', 'data_emissao', 'V'],
  ['CCB PRE FIXADO', 'termo', 'numero_documento', 'V'],
  ['CCB PRE FIXADO', 'termo', 'valor_total', 'V'],
  ['CONFISSAO DE DIVIDA', 'lastro', 'data_vencimento', 'V'],
  ['CONFISSAO DE DIVIDA', 'lastro', 'numero_documento', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'cedente_documento', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'data_aquisicao', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'data_emissao', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'data_vencimento', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'doc_cessionario', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'numero_documento', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'sacado_documento', 'V'],
  ['CONFISSAO DE DIVIDA', 'termo', 'sacado_nome', 'V'],
  ['CONTRATO', 'lastro', 'cedente_documento', 'V'],
  ['CONTRATO', 'lastro', 'data_emissao', 'V'],
  ['CONTRATO', 'lastro', 'data_vencimento', 'V'],
  ['CONTRATO', 'lastro', 'numero_documento', 'V'],
  ['CONTRATO', 'lastro', 'sacado_documento', 'V'],
  ['CONTRATO', 'lastro', 'sacado_nome', 'V'],
  ['CONTRATO', 'lastro', 'valor_total', 'V'],
  ['CONTRATO', 'termo', 'cedente_documento', 'V'],
  ['CONTRATO', 'termo', 'data_aquisicao', 'V'],
  ['CONTRATO', 'termo', 'data_emissao', 'V'],
  ['CONTRATO', 'termo', 'data_vencimento', 'V'],
  ['CONTRATO', 'termo', 'doc_cessionario', 'V'],
  ['CONTRATO', 'termo', 'nome_cessionario', 'V'],
  ['CONTRATO', 'termo', 'numero_documento', 'V'],
  ['CONTRATO', 'termo', 'sacado_documento', 'V'],
  ['CONTRATO', 'termo', 'sacado_nome', 'V'],
  ['CONTRATO', 'termo', 'valor_total', 'V'],
  ['DUPLICATA', 'lastro', 'data_vencimento', 'V'],
  ['DUPLICATA', 'termo', 'cedente_nome', 'V'],
  ['DUPLICATA', 'termo', 'data_aquisicao', 'V'],
  ['DUPLICATA', 'termo', 'data_emissao', 'V'],
  ['DUPLICATA', 'termo', 'data_vencimento', 'V'],
  ['DUPLICATA', 'termo', 'doc_cessionario', 'V'],
  ['DUPLICATA', 'termo', 'nome_cessionario', 'V'],
  ['DUPLICATA', 'termo', 'numero_documento', 'V'],
  ['DUPLICATA', 'termo', 'sacado_documento', 'V'],
  ['DUPLICATA', 'termo', 'sacado_nome', 'V'],
  ['DUPLICATA', 'termo', 'valor_total', 'V'],
  ['NOTA COMERCIAL', 'lastro', 'data_vencimento', 'V'],
  ['NOTA COMERCIAL', 'lastro', 'numero_documento', 'V'],
  ['NOTA COMERCIAL', 'lastro', 'sacado_nome', 'V'],
  ['NOTA COMERCIAL', 'termo', 'data_aquisicao', 'V'],
  ['NOTA COMERCIAL', 'termo', 'data_emissao', 'V'],
  ['NOTA COMERCIAL', 'termo', 'data_vencimento', 'V'],
  ['NOTA COMERCIAL', 'termo', 'doc_cessionario', 'V'],
  ['NOTA COMERCIAL', 'termo', 'nome_cessionario', 'V'],
  ['NOTA COMERCIAL', 'termo', 'numero_documento', 'V'],
  ['NOTA COMERCIAL', 'termo', 'sacado_nome', 'V'],
  ['NOTA COMERCIAL', 'termo', 'valor_total', 'V'],
  ['NOTA DE DEBITO', 'termo', 'cedente_nome', 'V'],
  ['NOTA DE DEBITO', 'termo', 'data_aquisicao', 'V'],
  ['NOTA DE DEBITO', 'termo', 'data_emissao', 'V'],
  ['NOTA DE DEBITO', 'termo', 'sacado_nome', 'D'],
];

export class Perfil {
  readonly familia: string;
  /** nº da amostra = nº impresso no documento + 2-3 dígitos da parcela. */
  readonly numero_com_parcela: boolean;
  /** Páginas onde um documento de um título só pode trazer os dados do título (null = todas). */
  readonly paginas_documento_inteiro: number | null;
  readonly termo_e_o_documento_do_titulo: boolean;
  readonly ancora_por_nome: boolean;
  readonly titulo_serve_de_termo: boolean;
  readonly rotulos: Record<string, string>;
  readonly corrige_numero_da_linha: boolean;
  readonly convencoes: Map<string, 'V' | 'D'>;
  private readonly regexRotulo = new Map<string, RegExp>();

  constructor(familia: string, ajustes: Partial<{
    numero_com_parcela: boolean; paginas_documento_inteiro: number | null; termo_e_o_documento_do_titulo: boolean;
    ancora_por_nome: boolean; titulo_serve_de_termo: boolean; rotulos: Record<string, string>;
    corrige_numero_da_linha: boolean;
  }> = {}) {
    this.familia = familia;
    this.numero_com_parcela = ajustes.numero_com_parcela ?? false;
    this.paginas_documento_inteiro = ajustes.paginas_documento_inteiro === undefined ? 15 : ajustes.paginas_documento_inteiro;
    this.termo_e_o_documento_do_titulo = ajustes.termo_e_o_documento_do_titulo ?? false;
    this.ancora_por_nome = ajustes.ancora_por_nome ?? false;
    this.titulo_serve_de_termo = ajustes.titulo_serve_de_termo ?? false;
    this.rotulos = ajustes.rotulos ?? {};
    this.corrige_numero_da_linha = ajustes.corrige_numero_da_linha ?? true;
    this.convencoes = new Map(CONVENCOES.filter(([f]) => f === familia).map(([, doc, campo, v]) => [`${doc}|${campo}`, v]));
  }

  /** Regex do rótulo do campo neste tipo, ou null (vale o padrão). */
  rotulo(campo: string): RegExp | null {
    const padrao = this.rotulos[campo];
    if (!padrao) return null;
    let r = this.regexRotulo.get(campo);
    if (!r) {
      r = re(padrao);
      this.regexRotulo.set(campo, r);
    }
    return r;
  }

  /** 'V', 'D' ou null — o que o time marca quando `documento` não traz o valor de `campo`. */
  convencao(documento: string, campo: string): 'V' | 'D' | null {
    return this.convencoes.get(`${documento}|${campo}`) ?? null;
  }
}

const ROTULOS_CCB = { cedente_documento: 'cedente|credor' };

const AJUSTES: Record<string, ConstructorParameters<typeof Perfil>[1]> = {
  'CCB DIGITAL': { numero_com_parcela: true, rotulos: ROTULOS_CCB },
  'CCB PRE DIGITAL': { numero_com_parcela: true, rotulos: ROTULOS_CCB },
  'CCB PRE BALCAO': { numero_com_parcela: true, rotulos: ROTULOS_CCB },
  'CCB PRE FIXADO': { numero_com_parcela: true, rotulos: ROTULOS_CCB },
  'CCB OUTRAS': { numero_com_parcela: true, rotulos: ROTULOS_CCB },
  CPR: { numero_com_parcela: true, titulo_serve_de_termo: true, termo_e_o_documento_do_titulo: true },
  'NOTA COMERCIAL': { paginas_documento_inteiro: null, termo_e_o_documento_do_titulo: true },
  DUPLICATA: { corrige_numero_da_linha: false },
  CONTRATO: { ancora_por_nome: true },
};

export const PERFIS: Record<string, Perfil> = Object.fromEntries(
  ['NOTA COMERCIAL', 'DUPLICATA', 'CCB DIGITAL', 'CCB PRE DIGITAL', 'CCB PRE FIXADO', 'CCB PRE BALCAO', 'CCB OUTRAS',
    'CONTRATO', 'CONFISSAO DE DIVIDA', 'NOTA DE DEBITO', 'CPR', 'OUTROS']
    .map((f) => [f, new Perfil(f, AJUSTES[f] ?? {})]),
);

export function perfilDe(tipoRecebivel: unknown): Perfil {
  return PERFIS[familiaRecebivel(tipoRecebivel)];
}

// ----------------------------------------------------------------------------
// Regras da administradora (QI TECH)
// ----------------------------------------------------------------------------

export type RegrasFundo = {
  nao_enviados?: string[];
  valor_pela_amostra?: boolean;
  administradora?: string | null;
  origem?: 'cadastro' | 'assinatura' | null;
};

/** Assinatura da amostra: linhas, quantas trazem emissão, quantas trazem valor de aquisição ≠ 0. */
export type AssinaturaAmostra = { linhas?: number; com_emissao?: number; com_valor_aquisicao?: number };

const REGRAS_POR_ADMINISTRADORA: Record<string, { nao_enviados: string[]; valor_pela_amostra: boolean }> = {
  qitech: { nao_enviados: ['data_emissao'], valor_pela_amostra: true },
};
const NOME_EXIBIDO: Record<string, string> = { qitech: 'QI TECH' };
const SEM_ADMINISTRADORA = ['', 'naoinformado', 'naoinformada'];
const MIN_LINHAS_ASSINATURA = 20;

function chave(nome: unknown): string {
  return (nome ? textoDoValor(nome) : '').toLowerCase().replace(/ã/g, 'a').replace(/[^a-z]/g, '');
}

function temAssinaturaQiTech(a: AssinaturaAmostra): boolean {
  return (a.linhas ?? 0) >= MIN_LINHAS_ASSINATURA && (a.com_emissao ?? 1) === 0 && (a.com_valor_aquisicao ?? 1) === 0;
}

/**
 * Regras do fundo dados os nomes das administradoras (cadastro) e, opcional,
 * a assinatura da amostra — mesmo resultado de regras_do_fundo do Python.
 */
export function regrasDoFundo(administradoras: (string | null | undefined)[], assinatura?: AssinaturaAmostra | null): Required<RegrasFundo> {
  const naoEnviados = new Set<string>();
  let pelaAmostra = false;
  let nomes: string[] = [];
  for (const nome of administradoras) {
    const c = chave(nome);
    for (const [prefixo, regras] of Object.entries(REGRAS_POR_ADMINISTRADORA)) {
      if (c.startsWith(prefixo)) {
        regras.nao_enviados.forEach((n) => naoEnviados.add(n));
        pelaAmostra = pelaAmostra || regras.valor_pela_amostra;
        nomes.push(NOME_EXIBIDO[prefixo] ?? textoDoValor(nome));
      }
    }
  }
  let origem: 'cadastro' | 'assinatura' | null = nomes.length ? 'cadastro' : null;
  const cadastrada = administradoras.some((n) => !SEM_ADMINISTRADORA.includes(chave(n)));
  if (!nomes.length && !cadastrada && assinatura && Object.keys(assinatura).length && temAssinaturaQiTech(assinatura)) {
    const regras = REGRAS_POR_ADMINISTRADORA.qitech;
    regras.nao_enviados.forEach((n) => naoEnviados.add(n));
    pelaAmostra = regras.valor_pela_amostra;
    nomes = ['QI TECH'];
    origem = 'assinatura';
  }
  const unicos = [...new Set(nomes)];
  return {
    nao_enviados: [...naoEnviados].sort(),
    valor_pela_amostra: pelaAmostra,
    administradora: unicos.join(', ') || null,
    origem,
  };
}

/**
 * Assinatura a partir das linhas da amostra (TODAS as linhas da base, não só
 * as pendências — é o `count(*)` de registroBases). Aceita as chaves no
 * formato do registro (`base_data_emissao`/`base_valor_aquisicao`), da
 * planilha (`DATA_EMISSAO`/`VALOR_AQUISICAO`) ou cru (`data_emissao`).
 */
export function assinaturaDaAmostra(linhas: Record<string, unknown>[]): AssinaturaAmostra {
  const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  let comEmissao = 0;
  let comValor = 0;
  for (const l of linhas) {
    const emissao = l.base_data_emissao ?? l.DATA_EMISSAO ?? l.data_emissao;
    const valor = l.base_valor_aquisicao ?? l.VALOR_AQUISICAO ?? l.valor_aquisicao;
    if (!vazio(emissao)) comEmissao++;
    if (!vazio(valor) && Number(String(valor).replace(',', '.')) !== 0) comValor++;
  }
  return { linhas: linhas.length, com_emissao: comEmissao, com_valor_aquisicao: comValor };
}

/** Atalho: regras do fundo pela administradora (opcional) e pela amostra inteira. */
export function regrasDoFundoDaAmostra(linhas: Record<string, unknown>[], administradora?: string | null): Required<RegrasFundo> {
  return regrasDoFundo(administradora ? [administradora] : [], assinaturaDaAmostra(linhas));
}
