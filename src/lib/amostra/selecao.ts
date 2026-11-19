import { createHash, randomBytes } from 'node:crypto';
import { normalizarSeedOuNull, seedDeBytes } from './seed';

/**
 * Sorteio da amostra — porta linha a linha de backend/modules/amostragem/selecao.py do Bate Lastro
 * (só biblioteca padrão lá, só node:crypto aqui). A mesma população com a mesma seed dá a mesma
 * amostra que o Bate Lastro: a nota de cada título é o SHA-256 de "amostragem-v1|seed|grupo|chave".
 *
 * Regras (amostragem-v1):
 * - Maiores Cedentes: os 5 cedentes de maior soma de VALOR_PRESENTE e, de cada um, os 3 títulos de
 *   maior VALOR_PRESENTE. Títulos da amostra anterior saem deste grupo (e só dele).
 * - Liquidados (opcional, só recompras): a mesma escolha feita à parte entra antes ("Maiores
 *   Cedentes - Recompras") e conta no saldo de Adquiridos.
 * - Adquiridos no Tri: DATA_AQUISICAO entre início e fim, inclusive.
 * - Vencidos no Tri: os não adquiridos com DATA_VENCIMENTO_AJUSTADA depois do início e até o fim.
 * - Os maiores cedentes ficam fora dos dois sorteios. Adquiridos sorteia limite − maiores (todos se
 *   o saldo não for positivo ou faltar candidato); Vencidos sorteia até o limite.
 * - Planner: sem maiores cedentes nem anterior; adquiridos e vencidos juntos, as 120 menores notas
 *   do grupo "planner".
 * - Valores em centavos inteiros; empates se desfazem pela chave (e entre cedentes pelo documento).
 */

/** Prefixo da nota: o mesmo do Bate Lastro, para a seed reproduzir a amostra lá e aqui. */
export const VERSAO_SORTEIO = 'amostragem-v1';

export const COLUNAS = [
  'NOME_FUNDO', 'NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO', 'DOC_SACADO',
  'SEU_NUMERO', 'NU_DOCUMENTO', 'TIPO_RECEBIVEL', 'VALOR_NOMINAL', 'VALOR_PRESENTE',
  'VALOR_AQUISICAO', 'DATA_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO_AJUSTADA',
  'DATA_EMISSAO', 'DATA_AQUISICAO', 'CHAVE_NFE',
] as const;
export type Coluna = (typeof COLUNAS)[number];
/** Título da população canônica: todos os campos em texto (datas ISO, valores "1234.50", vazio "-"). */
export type TituloCanonico = Record<Coluna, string>;

export const GRUPO_MAIORES = 'Maiores Cedentes';
export const GRUPO_MAIORES_RECOMPRAS = 'Maiores Cedentes - Recompras';
export const GRUPO_ADQUIRIDOS = 'Adquiridos no Tri';
export const GRUPO_VENCIDOS = 'Vencidos no Tri';
export const GRUPO_PENDENCIAS = 'Pendências';
export const ORDEM_GRUPOS = [GRUPO_MAIORES_RECOMPRAS, GRUPO_MAIORES, GRUPO_ADQUIRIDOS, GRUPO_VENCIDOS, GRUPO_PENDENCIAS];

export const QTD_CEDENTES = 5;
export const TITULOS_POR_CEDENTE = 3;
export const REGRA_PADRAO = 'padrao';
export const REGRA_PLANNER = 'planner';
export type Regra = typeof REGRA_PADRAO | typeof REGRA_PLANNER;
export const TETO_PLANNER = 120;

export type Parametros = {
  data_de: string;
  data_ate: string;
  limite_adquiridos: number;
  limite_vencidos: number;
  regra: Regra;
};

export type ItemSelecionado = { grupo: string; chave: string; nota: string; titulo: TituloCanonico };
export type ItemRegistrado = { grupo: string; chave: string; nota: string };

export class ErroAmostragem extends Error {
  constructor(mensagem: string, public status = 422) {
    super(mensagem);
  }
}

export function gerarSeed(): string {
  return seedDeBytes(randomBytes(8));
}

export function normalizarSeed(seed: string): string {
  const s = normalizarSeedOuNull(seed);
  if (!s) throw new ErroAmostragem('Seed inválida: use os 12 caracteres no formato XXXX-XXXX-XXXX.');
  return s;
}

/** CPF/CNPJ só com dígitos e sem zeros à esquerda; sem dígitos, o texto como veio. */
export function documento(doc: string): string {
  const d = doc.replace(/[^0-9]/g, '').replace(/^0+/, '');
  return d || doc;
}

export function chave(t: Pick<TituloCanonico, 'DOC_CEDENTE' | 'NU_DOCUMENTO' | 'SEU_NUMERO'>): string {
  return `${documento(t.DOC_CEDENTE)}|${t.NU_DOCUMENTO}|${t.SEU_NUMERO}`;
}

export function sha256(conteudo: Uint8Array | string): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

export function nota(seed: string, grupo: string, chaveTitulo: string): string {
  return sha256(`${VERSAO_SORTEIO}|${seed}|${grupo}|${chaveTitulo}`);
}

/** Centavos do VALOR_PRESENTE canônico ("-12.30" → -1230n). */
export function centavosDe(t: Pick<TituloCanonico, 'VALOR_PRESENTE'>): bigint {
  return BigInt(t.VALOR_PRESENTE.replace('.', ''));
}

/** Comparação de texto como o Python (por ponto de código, não por unidade UTF-16). */
export function compararTexto(a: string, b: string): number {
  if (a === b) return 0;
  // Sem surrogates, a ordem UTF-16 é a mesma dos pontos de código.
  if (!/[\ud800-\udfff]/.test(a) && !/[\ud800-\udfff]/.test(b)) return a < b ? -1 : 1;
  const pa = Array.from(a, (c) => c.codePointAt(0)!);
  const pb = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return pa.length - pb.length;
}

function sortear(candidatos: TituloCanonico[], n: number, seed: string, grupo: string): [TituloCanonico, string][] {
  const comNota = candidatos.map((t) => [t, nota(seed, grupo, chave(t)), chave(t)] as const);
  comNota.sort((x, y) => compararTexto(x[1], y[1]) || compararTexto(x[2], y[2]));
  return comNota.slice(0, n).map(([t, n2]) => [t, n2]);
}

function dataIso(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function validarParametros(p: Parametros): Parametros {
  if (!dataIso(p.data_de) || !dataIso(p.data_ate)) throw new ErroAmostragem('Informe as datas de início e fim do período.');
  if (p.data_de > p.data_ate) throw new ErroAmostragem('A data de início deve ser anterior ou igual à data fim.');
  for (const v of [p.limite_adquiridos, p.limite_vencidos]) {
    if (!Number.isInteger(v) || v < 0) throw new ErroAmostragem('Os limites de adquiridos e vencidos devem ser inteiros não negativos.');
  }
  if (p.regra !== REGRA_PADRAO && p.regra !== REGRA_PLANNER) throw new ErroAmostragem(`Regra de amostra desconhecida: ${p.regra}.`);
  return p;
}

type Acumulado = { totais: Map<string, bigint>; melhores: Map<string, [bigint, string, TituloCanonico][]> };

function acumular(a: Acumulado, t: TituloCanonico) {
  const cedente = documento(t.DOC_CEDENTE);
  const valor = centavosDe(t);
  a.totais.set(cedente, (a.totais.get(cedente) ?? 0n) + valor);
  let doCedente = a.melhores.get(cedente);
  if (!doCedente) a.melhores.set(cedente, (doCedente = []));
  doCedente.push([-valor, chave(t), t]);
  if (doCedente.length > TITULOS_POR_CEDENTE) {
    doCedente.sort(ordemItem);
    doCedente.pop();
  }
}

const ordemItem = (x: [bigint, string, TituloCanonico], y: [bigint, string, TituloCanonico]) =>
  (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0) || compararTexto(x[1], y[1]);

function maiores(a: Acumulado): TituloCanonico[] {
  const cedentes = [...a.totais.keys()].sort((x, y) => {
    const tx = a.totais.get(x)!, ty = a.totais.get(y)!;
    return (tx > ty ? -1 : tx < ty ? 1 : 0) || compararTexto(x, y);
  }).slice(0, QTD_CEDENTES);
  return cedentes.flatMap((c) => [...a.melhores.get(c)!].sort(ordemItem).map((i) => i[2]));
}

/** Amostra na ordem de saída (`selecionar`). */
export function selecionar(
  populacao: Iterable<TituloCanonico>,
  parametros: Parametros,
  seedInformada: string,
  chavesAnteriores: Iterable<string> = [],
  liquidados: Iterable<TituloCanonico> = [],
): ItemSelecionado[] {
  const seed = normalizarSeed(seedInformada);
  const { data_de: de, data_ate: ate, limite_adquiridos, limite_vencidos, regra } = validarParametros(parametros);

  const acc: Acumulado = { totais: new Map(), melhores: new Map() };
  let adquiridos: TituloCanonico[] = [];
  let vencidos: TituloCanonico[] = [];
  for (const t of populacao) {
    acumular(acc, t);
    const aq = t.DATA_AQUISICAO, venc = t.DATA_VENCIMENTO_AJUSTADA;
    if (aq && de <= aq && aq <= ate) adquiridos.push(t);
    else if (venc && de < venc && venc <= ate) vencidos.push(t);
  }

  let grandes: [string, TituloCanonico][] = maiores(acc).map((t) => [GRUPO_MAIORES, t]);
  if (regra !== REGRA_PLANNER) {
    const accLiq: Acumulado = { totais: new Map(), melhores: new Map() };
    for (const t of liquidados) acumular(accLiq, t);
    const recompras: [string, TituloCanonico][] = maiores(accLiq).map((t) => [GRUPO_MAIORES_RECOMPRAS, t]);
    const chavesRecompras = new Set(recompras.map(([, t]) => chave(t)));
    grandes = [...recompras, ...grandes.filter(([, t]) => !chavesRecompras.has(chave(t)))];
  }
  const chavesGrandes = new Set(grandes.map(([, t]) => chave(t)));
  adquiridos = adquiridos.filter((t) => !chavesGrandes.has(chave(t)));
  vencidos = vencidos.filter((t) => !chavesGrandes.has(chave(t)));

  if (regra === REGRA_PLANNER) {
    const grupoDe = new Map<string, string>();
    for (const t of adquiridos) grupoDe.set(chave(t), GRUPO_ADQUIRIDOS);
    for (const t of vencidos) grupoDe.set(chave(t), GRUPO_VENCIDOS);
    const candidatos = [...adquiridos, ...vencidos];
    return sortear(candidatos, Math.min(TETO_PLANNER, candidatos.length), seed, REGRA_PLANNER)
      .map(([t, n]) => ({ grupo: grupoDe.get(chave(t))!, chave: chave(t), nota: n, titulo: t }));
  }

  const anteriores = new Set(chavesAnteriores);
  grandes = grandes.filter(([, t]) => !anteriores.has(chave(t)));
  const saldo = limite_adquiridos - grandes.length;
  const qtdAdquiridos = saldo > 0 && saldo <= adquiridos.length ? saldo : adquiridos.length;
  const qtdVencidos = Math.min(limite_vencidos, vencidos.length);

  const amostra: ItemSelecionado[] = grandes.map(([g, t]) => ({ grupo: g, chave: chave(t), nota: '', titulo: t }));
  for (const [grupo, candidatos, qtd] of [[GRUPO_ADQUIRIDOS, adquiridos, qtdAdquiridos], [GRUPO_VENCIDOS, vencidos, qtdVencidos]] as const) {
    for (const [t, n] of sortear(candidatos, qtd, seed, grupo)) amostra.push({ grupo, chave: chave(t), nota: n, titulo: t });
  }
  return amostra;
}

/** Divergências entre duas seleções; vazia = mesma amostra (`comparar`). */
export function comparar(registrada: ItemRegistrado[], refeita: ItemRegistrado[]): string[] {
  const k = (s: ItemRegistrado) => `${s.grupo}\u0000${s.chave}\u0000${s.nota}`;
  const r1 = registrada.map(k), r2 = refeita.map(k);
  if (r1.length === r2.length && r1.every((v, i) => v === r2[i])) return [];
  const s1 = new Set(r1), s2 = new Set(r2);
  const div = [
    ...registrada.filter((s) => !s2.has(k(s))).map((s) => `Registrado e não refeito: ${s.grupo} ${s.chave}`),
    ...refeita.filter((s) => !s1.has(k(s))).map((s) => `Refeito e não registrado: ${s.grupo} ${s.chave}`),
  ];
  return div.length ? div : ['Mesmos títulos, mas em outra ordem.'];
}
