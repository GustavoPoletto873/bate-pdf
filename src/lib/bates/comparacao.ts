import {
  camposDoLado, CAMPO_POR_ID, chaveDocumento,
  type CampoId, type Lado, type TituloAmostra, type Veredito,
} from '@/lib/campos';
import { formatarData } from '@/lib/valores';

/**
 * Comparações base × leitura do Bate Lastro, portadas uma a uma (módulo puro: servidor e navegador).
 *
 * - `vereditoAutomatico`: calc_divergencia de routes/get/export_excel.py (colunas DIV_* do
 *   resultados_matching) com comparar_documento de utils/numero_documento.py;
 * - `vereditosDoLado`: veredito_do_campo de utils/marcacoes_match.py (a decisão salva vale mais
 *   que a comparação);
 * - `avaliarConfiabilidade`: utils/confiabilidade_pre_match.py (x/5 da tela de pré-bates);
 * - `codigoAlfanumerico`: o mesmo arquivo, usado também pela cascata do Processar Base.
 */

/** Os campos que uma leitura traz, com as chaves dos 11 campos conferidos (src/lib/campos.ts). */
export type LeituraCampos = Partial<Record<CampoId, string | null>>;

// ---------------------------------------------------------------------------
// Nº do documento
// ---------------------------------------------------------------------------

/** comparar_documento: letras contam, pontuação não; leitura sem nenhum dígito = P. */
export function compararDocumento(base: unknown, leitura: unknown): Veredito {
  const chaveLeitura = chaveDocumento(leitura);
  if (!/[0-9]/.test(chaveLeitura)) return 'P';
  return chaveLeitura === chaveDocumento(base) ? 'V' : 'D';
}

function vazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number' && Number.isNaN(v)) return true;
  return String(v).trim() === '';
}

/** unicodedata NFD + ascii + upper. */
function normalizar(s: unknown): string {
  return String(s).normalize('NFD').replace(/[^\x00-\x7f]/g, '').toUpperCase();
}

/**
 * Em códigos como 'A001LCMG' (CCB) ou 'BQPNYX/003' a chave numérica ('1', '3') é só um pedaço
 * do código: devolve o código inteiro normalizado, ou null quando o número não tem cara de
 * código ('NF 123' e 'DP479.1' continuam valendo pelo número).
 */
export function codigoAlfanumerico(doc: unknown): string | null {
  if (vazio(doc)) return null;
  const s = String(doc).toUpperCase();
  const trechos = s.match(/[A-Z0-9]+/g) ?? [];
  const temCodigo = trechos.some((t) => /\d[A-Z]/.test(t) || (t.match(/[A-Z]/g)?.length ?? 0) >= 4);
  if (!temCodigo) return null;
  return s.replace(/[^A-Z0-9]/g, '');
}

function chaveNumerica(doc: unknown): string {
  const m = /\d+/.exec(String(doc));
  return m ? (m[0].replace(/^0+/, '') || '0') : '';
}

/** numeros_conferem: igual, um é o outro com a parcela no fim, ou a mesma chave numérica que identifica. */
export function numerosConferem(base: unknown, leitura: unknown): boolean {
  if (vazio(base) || vazio(leitura)) return false;
  const a = normalizar(base).replace(/[^A-Z0-9]/g, '');
  const b = normalizar(leitura).replace(/[^A-Z0-9]/g, '');
  const [curto, longo] = b.length < a.length ? [b, a] : [a, b];
  if (curto && (curto === longo || (curto.length >= 4 && longo.startsWith(curto)))) return true;
  const chave = chaveNumerica(base);
  if (!chave || chave !== chaveNumerica(leitura)) return false;
  return chave.length >= 4 || (codigoAlfanumerico(base) === null && codigoAlfanumerico(leitura) === null);
}

// ---------------------------------------------------------------------------
// Confiabilidade do pré-bate (x/5)
// ---------------------------------------------------------------------------

export const TOLERANCIA_VALOR = 0.005;
export const TOLERANCIA_DIAS = 1;

const PALAVRAS_IGNORADAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'LTDA', 'SA', 'ME', 'EPP', 'EIRELI', 'CIA']);

export function valoresConferem(base: unknown, leitura: unknown): boolean {
  if (vazio(base) || vazio(leitura)) return false;
  const a = Number(base);
  const b = Number(leitura);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.min(a, b) <= TOLERANCIA_VALOR;
}

/** "AAAA-MM-DD…" → dia (número de dias desde 1970), ou null. */
export function diaDaData(v: unknown): number | null {
  if (vazio(v)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const t = Date.UTC(ano, mes - 1, dia);
  const d = new Date(t);
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return Math.round(t / 86_400_000);
}

export function datasConferem(base: unknown, leitura: unknown): boolean {
  const a = diaDaData(base);
  const b = diaDaData(leitura);
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= TOLERANCIA_DIAS;
}

function palavras(nome: unknown): string[] {
  const texto = normalizar(nome).replace(/[^A-Z0-9 ]/g, ' ');
  return texto.split(/\s+/).filter((p) => p.length > 1 && !PALAVRAS_IGNORADAS.has(p));
}

export function nomesConferem(base: unknown, leitura: unknown): boolean {
  if (vazio(base) || vazio(leitura)) return false;
  const pa = palavras(base);
  const pb = palavras(leitura);
  const ja = pa.join(' ');
  const jb = pb.join(' ');
  const [curto, longo] = jb.length < ja.length ? [jb, ja] : [ja, jb];
  if (!curto) return false;
  // A leitura costuma vir truncada ('FLAVIO CORREA DE MEL').
  if (curto === longo || (curto.length >= 10 && longo.startsWith(curto))) return true;
  const menor = Math.min(pa.length, pb.length);
  if (menor < 2) return false;
  const conjuntoB = new Set(pb);
  const comuns = new Set(pa.filter((p) => conjuntoB.has(p))).size;
  return comuns / menor >= 0.75;
}

/** Com documento dos dois lados, ele decide; senão, compara o nome. */
function partesConferem(docBase: unknown, docLeitura: unknown, nomeBase: unknown, nomeLeitura: unknown): boolean {
  const da = vazio(docBase) ? '' : String(docBase).replace(/\D/g, '');
  const db = vazio(docLeitura) ? '' : String(docLeitura).replace(/\D/g, '');
  if (da && db) return da === db;
  return nomesConferem(nomeBase, nomeLeitura);
}

/** Lado (base ou leitura) no formato que a tela de pré-bates mostra. */
export type LadoConfiabilidade = {
  numero_documento: string | null;
  valor_nominal: string | number | null;
  data_vencimento: string | null;
  nome_cedente: string | null;
  doc_cedente: string | null;
  nome_sacado: string | null;
  doc_sacado: string | null;
};

export type Confiabilidade = {
  percentual: number;
  conferem: number;
  total: number;
  campos: { campo: string; confere: boolean }[];
};

export const NIVEIS_CONFIABILIDADE = [100, 80, 60, 40, 20, 0] as const;

/** avaliar_confiabilidade: quantos dos 5 campos mostrados conferem (nº, valor, vencimento, cedente, sacado). */
export function avaliarConfiabilidade(base: LadoConfiabilidade, leitura: LadoConfiabilidade): Confiabilidade {
  const campos = [
    { campo: 'Número do documento', confere: numerosConferem(base.numero_documento, leitura.numero_documento) },
    { campo: 'Valor nominal', confere: valoresConferem(base.valor_nominal, leitura.valor_nominal) },
    { campo: 'Data de vencimento', confere: datasConferem(base.data_vencimento, leitura.data_vencimento) },
    { campo: 'Cedente', confere: partesConferem(base.doc_cedente, leitura.doc_cedente, base.nome_cedente, leitura.nome_cedente) },
    { campo: 'Sacado', confere: partesConferem(base.doc_sacado, leitura.doc_sacado, base.nome_sacado, leitura.nome_sacado) },
  ];
  const conferem = campos.filter((c) => c.confere).length;
  return { percentual: Math.round((conferem / campos.length) * 100), conferem, total: campos.length, campos };
}

// ---------------------------------------------------------------------------
// Veredito por campo (DIV_*)
// ---------------------------------------------------------------------------

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function numero(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * calc_divergencia do export do Bate Lastro: nº do documento e CNPJ do cessionário por
 * comparar_documento; nos demais, leitura vazia = P, igual (sem espaços nas pontas) = V, senão D.
 * Datas comparadas como dd/mm/aaaa e valores como número (o export compara str(float)).
 */
export function vereditoAutomatico(campo: CampoId, titulo: Partial<TituloAmostra>, leitura: LeituraCampos | null | undefined): Veredito {
  const def = CAMPO_POR_ID[campo];
  const base = titulo[def.campoBase];
  const lido = leitura?.[campo];
  if (campo === 'numero_documento' || campo === 'doc_cessionario') return compararDocumento(texto(base), texto(lido));
  if (def.tipo === 'moeda') {
    const l = numero(lido);
    if (!l) return 'P';
    return numero(base) === l ? 'V' : 'D';
  }
  if (def.tipo === 'data') {
    const l = formatarData(texto(lido));
    if (!l) return 'P';
    return formatarData(texto(base)).trim() === l.trim() ? 'V' : 'D';
  }
  const l = texto(lido);
  if (!l) return 'P';
  return texto(base).trim() === l.trim() ? 'V' : 'D';
}

/** veredito_do_campo: a decisão salva (V/D/P) tem precedência sobre a comparação. */
export function vereditoDoCampo(salvas: Partial<Record<CampoId, unknown>> | null | undefined, campo: CampoId, automatico: Veredito): Veredito {
  const v = salvas?.[campo];
  return v === 'V' || v === 'D' || v === 'P' ? v : automatico;
}

/** Veredito de cada campo do lado (Termo: 11; Lastro: 8). */
export function vereditosDoLado(
  lado: Lado,
  titulo: Partial<TituloAmostra>,
  leitura: LeituraCampos | null | undefined,
  salvas?: Partial<Record<CampoId, unknown>> | null,
): Partial<Record<CampoId, Veredito>> {
  const r: Partial<Record<CampoId, Veredito>> = {};
  for (const def of camposDoLado(lado)) r[def.campo] = vereditoDoCampo(salvas, def.campo, vereditoAutomatico(def.campo, titulo, leitura));
  return r;
}

/** Lado da leitura pelo TIPO_RECEBIVEL: 'termo_cessao…' = Termo; o resto (ou vazio) = Lastro. */
export function ladoDaLeitura(tipoRecebivel: string | null | undefined): Lado {
  return String(tipoRecebivel ?? '').trim().toLowerCase().startsWith('termo_cessao') ? 'termo' : 'lastro';
}
