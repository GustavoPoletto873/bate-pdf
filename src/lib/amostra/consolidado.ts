import { COLUNAS, documento, GRUPO_PENDENCIAS } from './selecao';
import { COLUNAS_DATA, COLUNAS_VALOR, type LinhaPlanilha } from './leitura';

/**
 * Amostra consolidada dos fundos Planner — porta de backend/modules/amostragem/consolidado.py.
 *
 * A amostra do trimestre T soma ao sorteio as pendências que seguem em aberto nos bates dos 3
 * trimestres anteriores. Aqui a "foto dos bates" vem do banco local: as bases do fundo e, por título,
 * se cada lado (Termo/Lastro) ainda está pendente (sem vínculo, sem pré-bate, sem ter vindo batido).
 */

export const JANELA = 3;
export const COLUNAS_ORIGEM = ['ORIGEM', 'TRIMESTRE_ORIGEM', 'PENDENTE_EM', 'PENDENCIA'];
export const COLUNAS_PLANILHA = [...COLUNAS_ORIGEM, ...COLUNAS, 'RELATORIO'];

/** Uma linha de título de uma base anterior do fundo (o que o Bate Lastro lê da registroBases). */
export type LinhaBaseAnterior = {
  id: number;
  BASE_ID: string;
  DATA_REFERENCIA: string;
  DATA_CRIACAO: string | null;
  NOME_FUNDO: string | null;
  NOME_CEDENTE: string | null;
  DOC_CEDENTE: string | null;
  NOME_SACADO: string | null;
  DOC_SACADO: string | null;
  NU_DOCUMENTO: string | null;
  TIPO_RECEBIVEL: string | null;
  VALOR_NOMINAL: string | null;
  VALOR_AQUISICAO: string | null;
  DATA_VENCIMENTO_ORIGINAL: string | null;
  DATA_EMISSAO: string | null;
  DATA_AQUISICAO: string | null;
  CHAVE_NFE: string | null;
  lastro: boolean;
  termo: boolean;
  base_teve_bate: boolean;
};

type Trimestre = string; // 'AAAA-MM-01'

export function inicioTrimestre(dia: string): Trimestre {
  const [a, m] = dia.split('-').map(Number);
  return `${a}-${String(3 * Math.floor((m - 1) / 3) + 1).padStart(2, '0')}-01`;
}

export function trimestreAnterior(inicio: Trimestre): Trimestre {
  const [a, m] = inicio.split('-').map(Number);
  const mes = m - 3;
  return `${mes < 1 ? a - 1 : a}-${String(((mes - 1 + 12) % 12) + 1).padStart(2, '0')}-01`;
}

export function rotulo(inicio: Trimestre): string {
  const [a, m] = inicio.split('-').map(Number);
  return `${Math.floor((m - 1) / 3) + 1}T${a}`;
}

export function janela(trimestre: Trimestre): Trimestre[] {
  const t = [trimestreAnterior(trimestre)];
  while (t.length < JANELA) t.push(trimestreAnterior(t[t.length - 1]));
  return t;
}

const textoOuTraco = (v: string | null | undefined) => (v === null || v === undefined ? '-' : String(v).trim() || '-');
const chaveDe = (doc: string | null, nu: string | null) => `${documento(textoOuTraco(doc))}|${textoOuTraco(nu)}`;

function centavos(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) return null;
  return Math.round(Number(v) * 100);
}

type Parcela = [number | null, string | null];
const parcela = (t: { VALOR_NOMINAL?: string | number | null; DATA_VENCIMENTO_ORIGINAL?: string | number | null }): Parcela =>
  [centavos(t.VALOR_NOMINAL), t.DATA_VENCIMENTO_ORIGINAL ? String(t.DATA_VENCIMENTO_ORIGINAL).slice(0, 10) : null];
const chaveParcela = (p: Parcela) => `${p[0]}|${p[1]}`;
function ordemParcela(a: Parcela, b: Parcela): number {
  const ka = [a[1] === null ? 1 : 0, a[1] ?? '', a[0] === null ? 1 : 0, a[0] ?? 0];
  const kb = [b[1] === null ? 1 : 0, b[1] ?? '', b[0] === null ? 1 : 0, b[0] ?? 0];
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

const pendenciaDe = (lastro: boolean, termo: boolean) =>
  !lastro && !termo ? 'Sem lastro e sem termo' : !lastro ? 'Sem lastro' : 'Sem termo';

type ParcelaPendente = [LinhaBaseAnterior, string];
export type ItemPendente = {
  chave: string;
  origem: Trimestre;
  pendente_em: Trimestre[];
  pendencia: Record<Trimestre, string>;
  parcelas: Record<Trimestre, ParcelaPendente[]>;
  parcelas_no_ultimo: number;
};
export type BaseResumida = { base_id: string; trimestre: Trimestre; titulos: number; teve_bate: boolean };
export type Pendencias = { trimestre: Trimestre; itens: ItemPendente[]; bases: BaseResumida[]; avisos: string[] };

/** `pendencias_em_aberto`: pendências que entram na amostra do trimestre (início do trimestre). */
export function pendenciasEmAberto(linhas: LinhaBaseAnterior[], trimestre: Trimestre): Pendencias {
  const r: Pendencias = { trimestre, itens: [], bases: [], avisos: [] };
  const bases = new Map<string, BaseResumida>();
  for (const l of linhas) {
    let b = bases.get(l.BASE_ID);
    if (!b) bases.set(l.BASE_ID, (b = { base_id: l.BASE_ID, trimestre: inicioTrimestre(l.DATA_REFERENCIA), titulos: 0, teve_bate: l.base_teve_bate }));
    b.titulos++;
  }
  r.bases = [...bases.values()].sort((a, b) => (a.trimestre < b.trimestre ? -1 : a.trimestre > b.trimestre ? 1 : a.base_id < b.base_id ? -1 : 1));

  const trimestresJanela = janela(trimestre);
  for (const inicio of [...trimestresJanela].reverse()) {
    const doTrimestre = r.bases.filter((b) => b.trimestre === inicio);
    const semBate = doTrimestre.filter((b) => !b.teve_bate);
    if (!doTrimestre.length) r.avisos.push(`Nenhuma base do ${rotulo(inicio)} no Lastro para este fundo.`);
    else if (semBate.length) {
      const qBases = semBate.length === 1 ? '1 base' : `${semBate.length} bases`;
      const n = semBate.reduce((s, b) => s + b.titulos, 0);
      const qTitulos = n === 1 ? '1 título' : `${n} títulos`;
      if (semBate.length === doTrimestre.length) {
        r.avisos.push(`O ${rotulo(inicio)} ainda não teve bate (${qBases}, ${qTitulos}): os títulos não entraram como pendência.`);
      } else {
        r.avisos.push(`No ${rotulo(inicio)}, ${qBases} sem bate (${qTitulos}) ${semBate.length === 1 ? 'ficou' : 'ficaram'} de fora; as pendências do trimestre vêm das bases que tiveram bate.`);
      }
    }
  }

  type Estado = { lastro: boolean; termo: boolean; linha: LinhaBaseAnterior; parcela: Parcela };
  const porTitulo = new Map<string, Map<Trimestre, Map<string, Estado>>>();
  const ordenadas = linhas.filter((l) => l.base_teve_bate).sort((a, b) => {
    const ka = [a.DATA_CRIACAO !== null ? 1 : 0, a.DATA_CRIACAO ?? '', a.id];
    const kb = [b.DATA_CRIACAO !== null ? 1 : 0, b.DATA_CRIACAO ?? '', b.id];
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
  for (const l of ordenadas) {
    const k = chaveDe(l.DOC_CEDENTE, l.NU_DOCUMENTO);
    let tri = porTitulo.get(k);
    if (!tri) porTitulo.set(k, (tri = new Map()));
    const ini = inicioTrimestre(l.DATA_REFERENCIA);
    let parcelas = tri.get(ini);
    if (!parcelas) tri.set(ini, (parcelas = new Map()));
    const p = parcela(l);
    const anterior = parcelas.get(chaveParcela(p));
    parcelas.set(chaveParcela(p), { lastro: l.lastro || (anterior?.lastro ?? false), termo: l.termo || (anterior?.termo ?? false), linha: l, parcela: p });
  }

  for (const [k, trimestres] of porTitulo) {
    const pendentes = new Map<Trimestre, ParcelaPendente[]>();
    for (const [ini, parcelas] of trimestres) {
      pendentes.set(ini, [...parcelas.values()].sort((a, b) => ordemParcela(a.parcela, b.parcela))
        .filter((p) => !(p.lastro && p.termo)).map((p) => [p.linha, pendenciaDe(p.lastro, p.termo)] as ParcelaPendente));
    }
    const ordem = [...trimestres.keys()].sort();
    const ultimo = ordem[ordem.length - 1];
    if (!trimestresJanela.includes(ultimo) || !pendentes.get(ultimo)!.length) continue;
    const sequencia: Trimestre[] = [];
    for (const ini of [...ordem].reverse()) {
      if (!pendentes.get(ini)!.length) break;
      sequencia.unshift(ini);
    }
    r.itens.push({
      chave: k,
      origem: sequencia[0],
      pendente_em: sequencia,
      pendencia: Object.fromEntries(sequencia.map((ini) => [ini, [...new Set(pendentes.get(ini)!.map(([, p]) => p))].join(' / ')])),
      parcelas: Object.fromEntries(sequencia.map((ini) => [ini, pendentes.get(ini)!])),
      parcelas_no_ultimo: trimestres.get(ultimo)!.size,
    });
  }
  r.itens.sort((a, b) => (a.origem < b.origem ? -1 : a.origem > b.origem ? 1 : a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
  return r;
}

/** Título da base no formato da planilha (a base não guarda SEU_NUMERO nem VALOR_PRESENTE). */
function linhaDaBase(t: LinhaBaseAnterior, nomeFundo: string): LinhaPlanilha {
  const linha: LinhaPlanilha = {};
  const fonte = t as unknown as Record<string, string | null>;
  for (const c of COLUNAS) {
    if (COLUNAS_VALOR.includes(c)) {
      const v = fonte[c];
      linha[c] = v === null || v === undefined ? null : Number(v);
    } else if (COLUNAS_DATA.includes(c)) linha[c] = fonte[c] ?? null;
    else linha[c] = textoOuTraco(fonte[c]);
  }
  linha.NOME_FUNDO = nomeFundo || textoOuTraco(t.NOME_FUNDO);
  linha.DATA_VENCIMENTO_AJUSTADA = t.DATA_VENCIMENTO_ORIGINAL;
  return linha;
}

export type ResumoConsolidado = {
  trimestre: string;
  janela: string[];
  bases: { base_id: string; trimestre: string; titulos: number; teve_bate: boolean }[];
  pendencias: { chave: string; origem: string; pendente_em: string[]; pendencia: string; parcelas: number }[];
  somadas: number;
  sorteadas_e_pendentes: number;
  avisos: string[];
};

function parNoSorteio(linha: LinhaPlanilha, faltam: ParcelaPendente[] | undefined, unica: boolean): number | null {
  if (!faltam || !faltam.length) return null;
  if (unica) return 0;
  const alvo = parcela(linha as { VALOR_NOMINAL: number | null; DATA_VENCIMENTO_ORIGINAL: string | null });
  for (let i = 0; i < faltam.length; i++) if (chaveParcela(parcela(faltam[i][0])) === chaveParcela(alvo)) return i;
  const mesmoValor = faltam.map((f, i) => [parcela(f[0])[0], i] as const).filter(([v]) => v === alvo[0]).map(([, i]) => i);
  return mesmoValor.length === 1 ? mesmoValor[0] : null;
}

/** `montar`: (Consolidado, abas de pendências por trimestre, resumo para o manifesto). */
export function montar(sorteio: LinhaPlanilha[], pendencias: Pendencias, nomeFundo = ''):
  { consolidado: LinhaPlanilha[]; abas: [string, LinhaPlanilha[]][]; resumo: ResumoConsolidado } {
  const trimestre = rotulo(pendencias.trimestre);
  const pendentes = new Map(pendencias.itens.map((p) => [p.chave, p]));
  const origem = (p: ItemPendente, pendencia: string) => ({
    TRIMESTRE_ORIGEM: rotulo(p.origem), PENDENTE_EM: p.pendente_em.map(rotulo).join(', '), PENDENCIA: pendencia,
  });
  const daBase = (p: ItemPendente, t: LinhaBaseAnterior, pendencia: string): LinhaPlanilha =>
    ({ ...linhaDaBase(t, nomeFundo), ORIGEM: 'Pendência', RELATORIO: GRUPO_PENDENCIAS, ...origem(p, pendencia) });

  const chaveLinha = (l: LinhaPlanilha) => chaveDe(l.DOC_CEDENTE as string, l.NU_DOCUMENTO as string);
  const porChave = new Map<string, number>();
  for (const l of sorteio) porChave.set(chaveLinha(l), (porChave.get(chaveLinha(l)) ?? 0) + 1);
  const faltam = new Map(pendencias.itens.map((p) => [p.chave, [...p.parcelas[p.pendente_em[p.pendente_em.length - 1]]]]));

  const consolidado: LinhaPlanilha[] = [];
  let sorteadasEPendentes = 0;
  for (const original of sorteio) {
    const linha = { ...original };
    const k = chaveLinha(linha);
    const p = pendentes.get(k);
    const unica = !!p && porChave.get(k) === 1 && p.parcelas_no_ultimo === 1;
    const i = parNoSorteio(linha, faltam.get(k), unica);
    if (i !== null && p) {
      const [, pendencia] = faltam.get(k)!.splice(i, 1)[0];
      sorteadasEPendentes++;
      Object.assign(linha, { ORIGEM: 'Amostra e pendência', ...origem(p, pendencia) });
    } else Object.assign(linha, { ORIGEM: 'Amostra', TRIMESTRE_ORIGEM: trimestre, PENDENTE_EM: '', PENDENCIA: '' });
    consolidado.push(linha);
  }
  let somadas = 0;
  for (const p of pendencias.itens) {
    for (const [t, pendencia] of faltam.get(p.chave)!) {
      consolidado.push(daBase(p, t, pendencia));
      somadas++;
    }
  }
  const abas: [string, LinhaPlanilha[]][] = [];
  const inicios = [...new Set(pendencias.itens.flatMap((p) => p.pendente_em))].sort().reverse();
  for (const ini of inicios) {
    abas.push([rotulo(ini), pendencias.itens.filter((p) => p.pendente_em.includes(ini)).flatMap((p) => p.parcelas[ini].map(([t, pend]) => daBase(p, t, pend)))]);
  }
  const resumo: ResumoConsolidado = {
    trimestre,
    janela: janela(pendencias.trimestre).map(rotulo),
    bases: pendencias.bases.map((b) => ({ base_id: b.base_id, trimestre: rotulo(b.trimestre), titulos: b.titulos, teve_bate: b.teve_bate })),
    pendencias: pendencias.itens.map((p) => {
      const ultimo = p.pendente_em[p.pendente_em.length - 1];
      return { chave: p.chave, origem: rotulo(p.origem), pendente_em: p.pendente_em.map(rotulo), pendencia: p.pendencia[ultimo], parcelas: p.parcelas[ultimo].length };
    }),
    somadas,
    sorteadas_e_pendentes: sorteadasEPendentes,
    avisos: [...pendencias.avisos],
  };
  return { consolidado, abas, resumo };
}
