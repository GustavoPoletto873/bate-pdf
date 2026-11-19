import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  comparar, compararTexto, ErroAmostragem, GRUPO_PENDENCIAS, normalizarSeed, REGRA_PADRAO, REGRA_PLANNER, selecionar, sha256,
  validarParametros, COLUNAS, type ItemRegistrado, type Parametros, type Regra,
} from './selecao';
import {
  COLUNAS_DATA, COLUNAS_VALOR, lerChavesAnteriores, lerEstoques, lerLiquidados, paraPlanilha, populacaoCsv,
  type Arquivo, type LinhaPlanilha,
} from './leitura';
import { COLUNAS_PLANILHA, montar, type Pendencias, type ResumoConsolidado } from './consolidado';

/**
 * Amostragem reproduzível — porta de backend/modules/amostragem/__init__.py. A amostra é função
 * dos insumos (SHA-256 de cada arquivo), dos parâmetros, do algoritmo e da seed, registrados no
 * manifesto. Módulo sem banco nem disco: quem chama guarda os arquivos e o manifesto.
 *
 * O sorteio é o mesmo do Bate Lastro (nota "amostragem-v1|…"). A leitura dos arquivos é a do
 * pandas reproduzida em TypeScript (pandas.ts); como não dá para garantir a mesma população em todo
 * formato raro de data, o manifesto daqui leva a versão "amostragem-v1-local".
 */
export const VERSAO = 'amostragem-v1-local';
export const VERSOES_ACEITAS = [VERSAO, 'amostragem-v1'];

export type InsumoRegistrado = { nome: string; sha256: string };
export type Manifesto = {
  versao: string;
  seed: string;
  parametros: Parametros;
  insumos: InsumoRegistrado[];
  amostra_anterior: { nome: string; sha256: string } | { amostragem_id: number; seed: string } | null;
  chaves_amostra_anterior: string[];
  populacao: { sha256: string; titulos: number };
  contagem: Record<string, number>;
  selecao: ItemRegistrado[];
  liquidados?: { insumos: InsumoRegistrado[]; populacao: { sha256: string; titulos: number } };
  consolidado?: ResumoConsolidado;
};

export type ResultadoAmostragem = {
  amostra: LinhaPlanilha[];
  populacaoCsv: Uint8Array;
  manifesto: Manifesto;
  avisos: string[];
  consolidado: LinhaPlanilha[] | null;
  abasPendencias: [string, LinhaPlanilha[]][];
  liquidadosCsv: Uint8Array;
  dataBase: string | null;
};

export const totalDeTitulos = (r: ResultadoAmostragem) => (r.consolidado ?? r.amostra).length;

function hashes(arquivos: Arquivo[]): InsumoRegistrado[] {
  return arquivos.map((a) => ({ nome: a.nome, sha256: sha256(a.conteudo) }))
    .sort((x, y) => compararTexto(x.sha256, y.sha256) || compararTexto(x.nome, y.nome));
}

export async function gerarAmostra(opcoes: {
  estoques: Arquivo[];
  dataDe: string;
  dataAte: string;
  limiteAdquiridos: number;
  limiteVencidos: number;
  seed: string;
  amostraAnterior?: Arquivo | null;
  nomeFundo?: string;
  regra?: Regra;
  chavesAnteriores?: string[] | null;
  liquidados?: Arquivo[];
}): Promise<ResultadoAmostragem> {
  const { estoques, dataDe, dataAte, limiteAdquiridos, limiteVencidos, amostraAnterior, nomeFundo = '', regra = REGRA_PADRAO } = opcoes;
  const liquidados = opcoes.liquidados ?? [];
  if (!estoques.length) throw new ErroAmostragem('Envie pelo menos um arquivo de estoque.');
  const seed = normalizarSeed(opcoes.seed);
  const parametros = validarParametros({ data_de: dataDe, data_ate: dataAte, limite_adquiridos: limiteAdquiridos, limite_vencidos: limiteVencidos, regra });

  const { populacao, avisos, dataBase } = await lerEstoques(estoques, dataDe, dataAte, regra !== REGRA_PLANNER);
  const csv = populacaoCsv(populacao);
  let liquidadosCsv: Uint8Array = new Uint8Array();
  let recompras: typeof populacao = [];
  let registroLiquidados: Manifesto['liquidados'];
  if (liquidados.length && regra === REGRA_PLANNER) {
    avisos.push('Na regra Planner os liquidados não entram na amostra; os arquivos foram ignorados.');
  } else if (liquidados.length) {
    const lidos = await lerLiquidados(liquidados);
    avisos.push(...lidos.avisos);
    recompras = lidos.recompras;
    liquidadosCsv = populacaoCsv(recompras);
    registroLiquidados = { insumos: hashes(liquidados), populacao: { sha256: sha256(liquidadosCsv), titulos: recompras.length } };
  }
  let chavesAnteriores = opcoes.chavesAnteriores ?? [];
  if (amostraAnterior) chavesAnteriores = await lerChavesAnteriores(amostraAnterior);
  chavesAnteriores = [...chavesAnteriores].sort(compararTexto);

  const escolhidos = selecionar(populacao, parametros, seed, chavesAnteriores, registroLiquidados ? recompras : []);
  const contagem: Record<string, number> = {};
  for (const i of escolhidos) contagem[i.grupo] = (contagem[i.grupo] ?? 0) + 1;
  const manifesto: Manifesto = {
    versao: VERSAO,
    seed,
    parametros,
    insumos: hashes(estoques),
    amostra_anterior: amostraAnterior ? { nome: amostraAnterior.nome, sha256: sha256(amostraAnterior.conteudo) } : null,
    chaves_amostra_anterior: chavesAnteriores,
    populacao: { sha256: sha256(csv), titulos: populacao.length },
    contagem,
    selecao: escolhidos.map((i) => ({ grupo: i.grupo, chave: i.chave, nota: i.nota })),
  };
  if (registroLiquidados) manifesto.liquidados = registroLiquidados;
  return {
    amostra: paraPlanilha(escolhidos, nomeFundo), populacaoCsv: csv, manifesto, avisos,
    consolidado: null, abasPendencias: [], liquidadosCsv, dataBase,
  };
}

/** Soma ao sorteio as pendências dos bates anteriores (fundos Planner). */
export function consolidar(r: ResultadoAmostragem, pendencias: Pendencias, nomeFundo = ''): void {
  const { consolidado, abas, resumo } = montar(r.amostra, pendencias, nomeFundo);
  r.consolidado = consolidado;
  r.abasPendencias = abas;
  r.manifesto.consolidado = resumo;
  if (resumo.somadas) r.manifesto.contagem[GRUPO_PENDENCIAS] = resumo.somadas;
  r.avisos.push(...pendencias.avisos);
}

function exigirMesmosArquivos(enviados: Arquivo[], registrados: InsumoRegistrado[], rotulo: string) {
  const env = new Map(enviados.map((a) => [sha256(a.conteudo), a.nome]));
  const reg = new Map(registrados.map((i) => [i.sha256, i.nome]));
  if (env.size === reg.size && [...env.keys()].every((h) => reg.has(h))) return;
  const faltando = [...reg].filter(([h]) => !env.has(h)).map(([, n]) => n);
  const sobrando = [...env].filter(([h]) => !reg.has(h)).map(([, n]) => n);
  const partes = [];
  if (faltando.length) partes.push(`faltam os arquivos registrados ${faltando.join(', ')}`);
  if (sobrando.length) partes.push(`não estão no manifesto ${sobrando.join(', ')}`);
  throw new ErroAmostragem(`Os ${rotulo} enviados não são os da amostra registrada: ${partes.join('; ')}. Para refazer, envie exatamente os mesmos arquivos (o conteúdo é conferido, não o nome).`);
}

/** Refaz a amostra de um manifesto com os mesmos arquivos: [resultado, divergências] (vazia = idêntica). */
export async function refazerAmostra(estoques: Arquivo[], manifesto: Manifesto, nomeFundo = '', liquidados: Arquivo[] = []):
  Promise<[ResultadoAmostragem, string[]]> {
  if (!VERSOES_ACEITAS.includes(manifesto.versao)) throw new ErroAmostragem(`O manifesto é da versão ${manifesto.versao}; este app refaz a ${VERSAO}.`);
  exigirMesmosArquivos(estoques, manifesto.insumos, 'estoques');
  const regLiq = manifesto.liquidados;
  if (regLiq) exigirMesmosArquivos(liquidados, regLiq.insumos, 'liquidados');
  const p = manifesto.parametros;
  const r = await gerarAmostra({
    estoques, dataDe: p.data_de, dataAte: p.data_ate, limiteAdquiridos: p.limite_adquiridos, limiteVencidos: p.limite_vencidos,
    seed: manifesto.seed, nomeFundo, regra: p.regra ?? REGRA_PADRAO, chavesAnteriores: manifesto.chaves_amostra_anterior ?? [],
    liquidados: regLiq ? liquidados : [],
  });
  r.manifesto.amostra_anterior = manifesto.amostra_anterior;
  const divergencias = comparar(manifesto.selecao, r.manifesto.selecao);
  if (r.manifesto.populacao.sha256 !== manifesto.populacao.sha256
    || (regLiq && r.manifesto.liquidados?.populacao.sha256 !== regLiq.populacao.sha256)) {
    divergencias.unshift('A população normalizada saiu diferente da registrada com os mesmos arquivos: a leitura dos arquivos mudou desde a geração.');
  }
  return [r, divergencias];
}

function descreverAnterior(a: Manifesto['amostra_anterior']): string {
  if (!a) return '-';
  if ('nome' in a) return a.nome;
  return `Amostra ${a.amostragem_id} (seed ${a.seed})`;
}

function dataDoTexto(v: string | number | null): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const [a, m, d] = v.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function escreverAba(livro: ExcelJS.Workbook, nome: string, colunas: string[], linhas: LinhaPlanilha[]) {
  const aba = livro.addWorksheet(nome.slice(0, 31));
  aba.columns = colunas.map((c) => ({
    header: c, key: c,
    width: Math.max(12, Math.min(40, c.length + 4)),
    style: COLUNAS_DATA.includes(c as never) ? { numFmt: 'dd/mm/yyyy' } : COLUNAS_VALOR.includes(c as never) ? { numFmt: '#,##0.00' } : {},
  }));
  aba.getRow(1).font = { bold: true };
  for (const l of linhas) {
    const linha: Record<string, unknown> = {};
    for (const c of colunas) {
      const v = l[c] ?? null;
      linha[c] = COLUNAS_DATA.includes(c as never) ? dataDoTexto(v) : v;
    }
    aba.addRow(linha);
  }
}

/** A planilha da amostra: primeira aba = a que o Upload Base lê (Amostra, ou Consolidado no Planner), e a aba Reproducao. */
export async function excelDaAmostra(r: ResultadoAmostragem): Promise<Uint8Array> {
  const m = r.manifesto;
  const resumo = m.consolidado;
  const reproducao: [string, string | number][] = [
    ['Seed', m.seed],
    ['Versão do algoritmo', m.versao],
    ['Regra', m.parametros.regra],
    ['Data de início', m.parametros.data_de],
    ['Data fim', m.parametros.data_ate],
    ['Limite de adquiridos', m.parametros.limite_adquiridos],
    ['Limite de vencidos', m.parametros.limite_vencidos],
    ['Títulos na população', m.populacao.titulos],
    ['SHA-256 da população', m.populacao.sha256],
    ...m.insumos.map((i) => [`SHA-256 de ${i.nome}`, i.sha256] as [string, string]),
    ...(m.liquidados ? [
      ['Recompras nos liquidados', m.liquidados.populacao.titulos] as [string, number],
      ...m.liquidados.insumos.map((i) => [`SHA-256 de ${i.nome}`, i.sha256] as [string, string]),
    ] : []),
    ['Amostra anterior', descreverAnterior(m.amostra_anterior)],
    ...(resumo ? [
      ['Pendências somadas', resumo.somadas] as [string, number],
      ['Pendências que caíram no sorteio', resumo.sorteadas_e_pendentes] as [string, number],
      ['Pendências', 'Foto dos bates anteriores no momento da geração; a seed refaz só o sorteio.'] as [string, string],
      ...resumo.avisos.map((a) => ['Aviso', a] as [string, string]),
    ] : []),
  ];
  const livro = new ExcelJS.Workbook();
  livro.creator = 'Lastro (versão local)';
  const colunasAmostra = [...COLUNAS, 'RELATORIO'];
  if (resumo && r.consolidado) {
    escreverAba(livro, 'Consolidado', COLUNAS_PLANILHA, r.consolidado);
    escreverAba(livro, `Amostra ${resumo.trimestre}`, colunasAmostra, r.amostra);
    for (const [tri, linhas] of r.abasPendencias) escreverAba(livro, `Pendências ${tri}`, COLUNAS_PLANILHA, linhas);
  } else {
    escreverAba(livro, 'Amostra', colunasAmostra, r.amostra);
  }
  const aba = livro.addWorksheet('Reproducao');
  aba.columns = [{ header: 'Campo', key: 'c', width: 38 }, { header: 'Valor', key: 'v', width: 80 }];
  aba.getRow(1).font = { bold: true };
  for (const [c, v] of reproducao) aba.addRow({ c, v });
  return new Uint8Array(await livro.xlsx.writeBuffer());
}

/** ZIP para o auditor: a planilha (com a aba Reproducao) e os estoques e liquidados originais. */
export async function montarPacote(amostraXlsx: Uint8Array, estoques: Arquivo[] = [], liquidados: Arquivo[] = []): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('amostra.xlsx', amostraXlsx);
  for (const a of estoques) zip.file(`estoques/${a.nome}`, a.conteudo);
  for (const a of liquidados) zip.file(`liquidados/${a.nome}`, a.conteudo);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export { REGRA_PADRAO, REGRA_PLANNER };
