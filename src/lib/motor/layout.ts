/**
 * Aprendizado por layout (backend/services/perfis_layout.py): o que o time
 * marca, em cada modelo de documento, quando o documento não traz o campo.
 *
 * Layout = palavras de modelo da 1ª página (as que se repetem entre 3+ PDFs).
 * Dois documentos são do mesmo layout com Jaccard >= 0,55. Convenção só com
 * padrão claro: >= 3 títulos e >= 85% (presente → D: >= 5 e >= 95%).
 */
import { Contador, findall, re, round2 } from './py';

export type Convencao = { veredito: string; titulos: number; acordo: number; fonte: 'layout' | 'catalogo' };

const RE_PALAVRA = re('[a-z]{3,}');
export const SIMILARIDADE_LAYOUT = 0.55;
export const MIN_EXEMPLOS = 3;
export const MIN_ACORDO = 0.85;
export const MIN_EXEMPLOS_PRESENTE = 5;
export const MIN_ACORDO_PRESENTE = 0.95;
export const MIN_TITULOS_LOTE_CONFIRMADO = 10;
export const MIN_FRACAO_LOTE_CONFIRMADO = 0.8;
const MIN_PDFS_PALAVRA_MODELO = 3;

function decidir(contagem: Contador<string>, minimo: number, acordoMinimo: number): Convencao | null {
  const total = contagem.total();
  if (total < minimo) return null;
  const [veredito, n] = contagem.maisComum()!;
  const acordo = n / total;
  return acordo >= acordoMinimo ? { veredito, titulos: total, acordo: round2(acordo), fonte: 'layout' } : null;
}

/** Palavras (3+ letras) do começo da 1ª página do PDF. */
export function palavrasDaPrimeiraPagina(paginasPdf: { numero: number; texto: string }[]): Set<string> {
  if (!paginasPdf.length) return new Set();
  let primeira = paginasPdf[0];
  for (const pg of paginasPdf) if (pg.numero < primeira.numero) primeira = pg;
  return new Set(findall(RE_PALAVRA, primeira.texto.slice(0, 3000)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of menor) if (maior.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function chaveConjunto(s: Set<string>): string {
  return [...s].sort().join(' ');
}

/** Chave do lote: (aquisição, cedente). */
export type ChaveLote = [string | null, string | null];

function chaveDoLote(c: ChaveLote): string {
  return JSON.stringify(c);
}

/** Interface mínima que o motor usa (os testes passam um aprendizado fixo). */
export interface Aprendizado {
  convencao(pdf: string, campo: string, opcoes?: { excluir?: unknown; papel?: string | null; presente?: boolean }): Convencao | null;
  vereditos(pdf: string, campo: string, opcoes?: { excluir?: unknown; papel?: string | null; presente?: boolean }): Contador<string>;
  eh_layout_de_lote?(pdf: string, excluir?: unknown): boolean;
  pdf_do_lote?(chave: ChaveLote, excluir?: unknown): string | null;
}

/** Convenções por layout aprendidas com os títulos já conferidos. */
export class AprendizadoLayout implements Aprendizado {
  readonly _modelo: Set<string>;
  readonly _assinatura = new Map<string, Set<string>>();
  readonly _layouts: Set<string>[] = [];
  private readonly _layout_do_pdf = new Map<string, number>();
  private readonly _layout_da_assinatura = new Map<string, number>();
  /** (layout, papel, campo, presente) -> [(registro_base_id, veredito)] */
  readonly _vereditos = new Map<string, { layout: number; papel: string | null; campo: string; presente: boolean; lista: [unknown, string][] }>();
  private readonly _papeis = new Map<string, (string | null)[]>();
  private readonly _sem_titulo = new Map<number, Set<unknown>>();
  private readonly _titulos_por_pdf = new Map<string, Set<unknown>>();
  private readonly _lote_por_chave = new Map<string, Map<string, Set<unknown>>>();
  private readonly _lotes = new Map<number, Set<unknown>[]>();
  catalogo: CatalogoGlobal | null = null;

  constructor(palavrasPorPdf: Map<string, Set<string>>) {
    const frequencia = new Contador<string>();
    for (const palavras of palavrasPorPdf.values()) for (const p of palavras) frequencia.add(p);
    this._modelo = new Set([...frequencia.contagem].filter(([, n]) => n >= MIN_PDFS_PALAVRA_MODELO).map(([w]) => w));
    for (const [pdf, p] of palavrasPorPdf) this._assinatura.set(pdf, new Set([...p].filter((w) => this._modelo.has(w))));
  }

  /** Índice do layout do PDF (criando um novo se nenhum for parecido). */
  layout(pdf: string): number {
    const ja = this._layout_do_pdf.get(pdf);
    if (ja !== undefined) return ja;
    const assinatura = this._assinatura.get(pdf) ?? new Set<string>();
    const chave = chaveConjunto(assinatura);
    let melhor = this._layout_da_assinatura.get(chave);
    if (melhor === undefined) {
      let sim = 0;
      let escolhido: number | undefined;
      this._layouts.forEach((rep, i) => {
        const j = jaccard(assinatura, rep);
        if (j > sim) {
          escolhido = i;
          sim = j;
        }
      });
      if (escolhido === undefined || sim < SIMILARIDADE_LAYOUT) {
        escolhido = this._layouts.length;
        this._layouts.push(assinatura);
      }
      melhor = escolhido;
      this._layout_da_assinatura.set(chave, melhor);
    }
    this._layout_do_pdf.set(pdf, melhor);
    const titulos = this._titulos_por_pdf.get(pdf);
    if (titulos !== undefined && titulos.size >= 2) this.lotesDo(melhor).push(titulos);
    return melhor;
  }

  private lotesDo(layout: number): Set<unknown>[] {
    let l = this._lotes.get(layout);
    if (!l) {
      l = [];
      this._lotes.set(layout, l);
    }
    return l;
  }

  /** O time marcou `veredito` em `campo` do documento `pdf`, vinculado no `papel` 'termo' ou 'lastro'. */
  observar(pdf: string, campo: string, veredito: string, registroBaseId: unknown, papel: string | null = null, presente = false): void {
    if (veredito !== 'V' && veredito !== 'D') return;
    const layout = this.layout(pdf);
    const chave = `${layout}|${papel}|${campo}|${presente}`;
    let item = this._vereditos.get(chave);
    if (!item) {
      item = { layout, papel, campo, presente, lista: [] };
      this._vereditos.set(chave, item);
      const chavePapeis = `${layout}|${campo}|${presente}`;
      const papeis = this._papeis.get(chavePapeis) ?? [];
      papeis.push(papel);
      this._papeis.set(chavePapeis, papeis);
    }
    item.lista.push([registroBaseId, veredito]);
  }

  /** O time vinculou `pdf` ao título; `trazOTitulo`: o documento traz nº, CPF/CNPJ ou nome do sacado. */
  observar_vinculo(pdf: string, registroBaseId: unknown, trazOTitulo: boolean, chaveLote: ChaveLote | null = null): void {
    let titulos = this._titulos_por_pdf.get(pdf);
    if (!titulos) {
      titulos = new Set();
      this._titulos_por_pdf.set(pdf, titulos);
    }
    const tinha = titulos.size;
    titulos.add(registroBaseId);
    if (tinha === 1 && titulos.size === 2 && this._layout_do_pdf.has(pdf)) {
      this.lotesDo(this._layout_do_pdf.get(pdf)!).push(titulos);
    }
    if (!trazOTitulo) {
      const layout = this.layout(pdf);
      let sem = this._sem_titulo.get(layout);
      if (!sem) {
        sem = new Set();
        this._sem_titulo.set(layout, sem);
      }
      sem.add(registroBaseId);
      if (chaveLote && chaveLote.every((x) => x)) {
        const k = chaveDoLote(chaveLote);
        let porPdf = this._lote_por_chave.get(k);
        if (!porPdf) {
          porPdf = new Map();
          this._lote_por_chave.set(k, porPdf);
        }
        let ids = porPdf.get(pdf);
        if (!ids) {
          ids = new Set();
          porPdf.set(pdf, ids);
        }
        ids.add(registroBaseId);
      }
    }
  }

  /** O PDF em que o time vinculou 10+ títulos e 80%+ da chave (aquisição, cedente) sem o documento trazer o título. */
  pdf_do_lote(chaveLote: ChaveLote, excluir: unknown = null): string | null {
    const porPdf = this._lote_por_chave.get(chaveDoLote(chaveLote));
    if (!porPdf) return null;
    const contagem: [string, number][] = [...porPdf].map(([pdf, ids]) => [pdf, ids.size - (ids.has(excluir) ? 1 : 0)]);
    const total = contagem.reduce((s, [, n]) => s + n, 0);
    if (!total) return null;
    let melhor = contagem[0];
    for (const c of contagem) if (c[1] > melhor[1] || (c[1] === melhor[1] && c[0] > melhor[0])) melhor = c;
    const [pdf, n] = melhor;
    return n >= MIN_TITULOS_LOTE_CONFIRMADO && n / total >= MIN_FRACAO_LOTE_CONFIRMADO ? pdf : null;
  }

  /** O time usa documentos deste layout como documento do lote. */
  eh_layout_de_lote(pdf: string, excluir: unknown = null): boolean {
    const layout = this.layout(pdf);
    const semTitulo = this._sem_titulo.get(layout) ?? new Set();
    if (semTitulo.size - (semTitulo.has(excluir) ? 1 : 0) < 2) return false;
    return (this._lotes.get(layout) ?? []).some((titulos) => titulos.size - (titulos.has(excluir) ? 1 : 0) >= 2);
  }

  private contagem(layout: number, papel: string | null, campo: string, presente: boolean, excluir: unknown): Contador<string> {
    const listas = papel !== null
      ? [this._vereditos.get(`${layout}|${papel}|${campo}|${presente}`)?.lista ?? []]
      : (this._papeis.get(`${layout}|${campo}|${presente}`) ?? []).map((p) => this._vereditos.get(`${layout}|${p}|${campo}|${presente}`)!.lista);
    const c = new Contador<string>();
    for (const lista of listas) for (const [rid, v] of lista) if (rid !== excluir) c.add(v);
    return c;
  }

  /** Contagem dos vereditos do time pro campo no layout do PDF (no papel). */
  vereditos(pdf: string, campo: string, opcoes: { excluir?: unknown; papel?: string | null; presente?: boolean } = {}): Contador<string> {
    return this.contagem(this.layout(pdf), opcoes.papel ?? null, campo, opcoes.presente ?? false, opcoes.excluir ?? null);
  }

  /** Convenção quando o padrão do layout é claro; null se não há. */
  convencao(pdf: string, campo: string, opcoes: { excluir?: unknown; papel?: string | null; presente?: boolean } = {}): Convencao | null {
    const papel = opcoes.papel ?? null;
    const presente = opcoes.presente ?? false;
    const excluir = opcoes.excluir ?? null;
    const layout = this.layout(pdf);
    const [minimo, acordoMinimo] = presente ? [MIN_EXEMPLOS_PRESENTE, MIN_ACORDO_PRESENTE] : [MIN_EXEMPLOS, MIN_ACORDO];
    const proprio = this.contagem(layout, papel, campo, presente, excluir);
    const decidida = decidir(proprio, minimo, acordoMinimo);
    if (decidida) return decidida;
    const todos = papel !== null ? this.contagem(layout, null, campo, presente, excluir) : proprio;
    if (papel !== null) {
      const geral = decidir(todos, minimo, acordoMinimo);
      if (geral && (!proprio.size || proprio.maisComum()![0] === geral.veredito)) return geral;
    }
    if (todos.total() < minimo && this.catalogo !== null) {
      return this.catalogo.convencao(this._layouts[layout], papel, campo, presente);
    }
    return null;
  }

  /** Itens dos vereditos (pro montarCatalogo). */
  itensVereditos() {
    return [...this._vereditos.values()];
  }
}

// ----------------------------------------------------------------------------
// Catálogo global (padrões de outros fundos; arquivo local)
// ----------------------------------------------------------------------------

const MIN_FUNDOS_PALAVRA = 3;
export const MIN_FUNDOS_CATALOGO = 2;
export const MIN_EXEMPLOS_CATALOGO = 5;
export const MIN_ACORDO_CATALOGO = 0.9;
export const MIN_FUNDOS_CONVENCAO = 3;
export const MIN_ACORDO_FUNDOS = 0.9;

export type ItemCatalogo = { V: number; D: number; fundos_V?: number; fundos_D?: number };
export type DadosCatalogo = {
  versao?: number;
  layouts?: { assinatura: string[]; fundos: number; bases: number; vereditos: Record<string, ItemCatalogo> }[];
};

/** Catálogo (JSON) a partir de [(base, fundo, AprendizadoLayout)] do histórico. */
export function montarCatalogo(aprendizados: [string, string, AprendizadoLayout][], palavrasDeNome: Set<string> = new Set()): DadosCatalogo {
  const fundosDaPalavra = new Map<string, Set<string>>();
  for (const [, fundo, a] of aprendizados) {
    for (const palavra of a._modelo) {
      const s = fundosDaPalavra.get(palavra) ?? new Set();
      s.add(fundo);
      fundosDaPalavra.set(palavra, s);
    }
  }
  const vocabulario = new Set([...fundosDaPalavra].filter(([p, f]) => f.size >= MIN_FUNDOS_PALAVRA && !palavrasDeNome.has(p)).map(([p]) => p));
  type Alvo = {
    assinatura: Set<string>; fundos: Set<string>; bases: Set<string>;
    vereditos: Map<string, { V: number; D: number; por_fundo: Map<string, Contador<string>> }>;
  };
  const layouts: Alvo[] = [];
  for (const [base, fundo, a] of aprendizados) {
    const destino = new Map<number, Alvo>();
    a._layouts.forEach((assinatura, i) => {
      const reduzida = new Set([...assinatura].filter((w) => vocabulario.has(w)));
      if (!reduzida.size) return;
      let alvo: Alvo | null = null;
      let sim = 0;
      for (const item of layouts) {
        const j = jaccard(reduzida, item.assinatura);
        if (j > sim) {
          alvo = item;
          sim = j;
        }
      }
      if (alvo === null || sim < SIMILARIDADE_LAYOUT) {
        alvo = { assinatura: reduzida, fundos: new Set(), bases: new Set(), vereditos: new Map() };
        layouts.push(alvo);
      }
      destino.set(i, alvo);
    });
    for (const { layout, papel, campo, presente, lista } of a.itensVereditos()) {
      const alvo = destino.get(layout);
      if (!alvo) continue;
      alvo.fundos.add(fundo);
      alvo.bases.add(base);
      const k = `${papel === null ? 'None' : papel}|${campo}|${presente ? 1 : 0}`;
      let item = alvo.vereditos.get(k);
      if (!item) {
        item = { V: 0, D: 0, por_fundo: new Map() };
        alvo.vereditos.set(k, item);
      }
      let doFundo = item.por_fundo.get(fundo);
      if (!doFundo) {
        doFundo = new Contador();
        item.por_fundo.set(fundo, doFundo);
      }
      for (const [, veredito] of lista) {
        item[veredito as 'V' | 'D'] += 1;
        doFundo.add(veredito);
      }
    }
  }
  const resumo = (v: { V: number; D: number; por_fundo: Map<string, Contador<string>> }): ItemCatalogo => {
    const votos = new Contador<string>([...v.por_fundo.values()].map((c) => c.maisComum()![0]));
    return { V: v.V, D: v.D, fundos_V: votos.get('V'), fundos_D: votos.get('D') };
  };
  return {
    versao: CatalogoGlobal.VERSAO,
    layouts: layouts.filter((item) => item.fundos.size >= MIN_FUNDOS_CATALOGO).map((item) => ({
      assinatura: [...item.assinatura].sort(),
      fundos: item.fundos.size,
      bases: item.bases.size,
      vereditos: Object.fromEntries([...item.vereditos].map(([k, v]) => [k, resumo(v)])),
    })),
  };
}

/** Consulta ao catálogo gerado por montarCatalogo (o JSON já lido). */
export class CatalogoGlobal {
  static readonly VERSAO = 2;
  private readonly _layouts: [Set<string>, Record<string, ItemCatalogo>][];
  private readonly _vocabulario: Set<string>;

  constructor(dados: DadosCatalogo | null | undefined) {
    let d: DadosCatalogo = dados ?? {};
    if (d.versao !== CatalogoGlobal.VERSAO) d = {};
    this._layouts = (d.layouts ?? []).map((item) => [new Set(item.assinatura), item.vereditos]);
    this._vocabulario = new Set(this._layouts.flatMap(([a]) => [...a]));
  }

  get length(): number {
    return this._layouts.length;
  }

  convencao(assinatura: Set<string>, papel: string | null, campo: string, presente: boolean): Convencao | null {
    const reduzida = new Set([...assinatura].filter((w) => this._vocabulario.has(w)));
    let melhor: Record<string, ItemCatalogo> | null = null;
    let sim = 0;
    for (const [a, vereditos] of this._layouts) {
      const j = jaccard(reduzida, a);
      if (j > sim) {
        melhor = vereditos;
        sim = j;
      }
    }
    if (melhor === null || sim < SIMILARIDADE_LAYOUT) return null;
    const item = melhor[`${papel === null ? 'None' : papel}|${campo}|${presente ? 1 : 0}`];
    if (!item) return null;
    const total = item.V + item.D;
    if (total < MIN_EXEMPLOS_CATALOGO) return null;
    const veredito = item.V >= item.D ? 'V' : 'D';
    const votos = (item.fundos_V ?? 0) + (item.fundos_D ?? 0);
    const doVeredito = veredito === 'V' ? item.fundos_V ?? 0 : item.fundos_D ?? 0;
    if (votos < MIN_FUNDOS_CONVENCAO || doVeredito / votos < MIN_ACORDO_FUNDOS) return null;
    const acordo = Math.max(item.V, item.D) / total;
    if (acordo < (presente ? Math.max(MIN_ACORDO_CATALOGO, MIN_ACORDO_PRESENTE) : MIN_ACORDO_CATALOGO)) return null;
    return { veredito, titulos: total, acordo: round2(acordo), fonte: 'catalogo' };
  }
}

/** CatalogoGlobal do JSON já lido; null sem dados ou com dados inválidos (o motor segue sem ele). */
export function carregarCatalogo(dados: unknown): CatalogoGlobal | null {
  if (!dados || typeof dados !== 'object') return null;
  try {
    return new CatalogoGlobal(dados as DadosCatalogo);
  } catch {
    return null;
  }
}
