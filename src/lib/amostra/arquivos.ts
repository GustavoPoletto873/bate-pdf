/**
 * Regras dos arquivos enviados na Amostra (frontend/src/pages/Amostra/arquivos.js, lote.js e
 * dataBase.js do Bate Lastro), usadas na tela, no lote e na conferência. Sem dependências do Node.
 */

export const digitos = (texto: string | null | undefined) => (texto || '').replace(/\D/g, '');
export const mascaraCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

// Mesma regra de nome dos apps do SimplificaHub: estoque é "Estoque…" ou "Conciliação…"; liquidados,
// "Liquidados…" do Fromtis ou "Movimentações" da ARP. O resto não é nenhum dos dois.
export const ehLiquidados = (nome: string) => /quida|ovimenta/i.test(nome);
export const ehEstoque = (nome: string) => !ehLiquidados(nome) && /stoque|oncilia/i.test(nome);
export const EXTENSOES = ['.csv', '.xlsx'];
export const extensaoAceita = (nome: string) => EXTENSOES.some((e) => nome.toLowerCase().endsWith(e));

export function cnpjsDoNome(nome: string): string[] {
  return [...nome.replace(/[./-]/g, '').matchAll(/(?:^|\D)(\d{14})(?!\d)/g)].map((m) => m[1]);
}

type ComNome = { name: string; size: number };
export const mesmoArquivo = (a: ComNome, b: ComNome) => a.name === b.name && a.size === b.size;
export const juntar = <T extends ComNome>(atuais: T[], novos: T[]) => [...atuais, ...novos.filter((n) => !atuais.some((a) => mesmoArquivo(a, n)))];

export function separar<T extends ComNome>(arquivos: T[]) {
  return { estoques: arquivos.filter((a) => !ehLiquidados(a.name)), liquidados: arquivos.filter((a) => ehLiquidados(a.name)) };
}

export const recusados = <T extends ComNome>(arquivos: T[]) => arquivos.filter((a) => !ehEstoque(a.name) && !ehLiquidados(a.name));

export function alertaCnpj(nome: string, fundo: { cnpj: string } | null | undefined): string | null {
  const cnpjs = cnpjsDoNome(nome);
  if (fundo && cnpjs.length && !cnpjs.includes(digitos(fundo.cnpj))) {
    return `O nome traz o CNPJ ${mascaraCnpj(cnpjs[0])}, diferente do fundo escolhido (${mascaraCnpj(digitos(fundo.cnpj))}).`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

const iso = (ano: number, mes: number, dia: number) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** Último trimestre fechado (padrão da tela). */
export function trimestreAnterior(hoje = new Date()): { dataDe: string; dataAte: string } {
  const inicioAtual = new Date(hoje.getFullYear(), Math.floor(hoje.getMonth() / 3) * 3, 1);
  const fim = new Date(inicioAtual.getFullYear(), inicioAtual.getMonth(), 0);
  const inicio = new Date(fim.getFullYear(), fim.getMonth() - 2, 1);
  return { dataDe: iso(inicio.getFullYear(), inicio.getMonth() + 1, 1), dataAte: iso(fim.getFullYear(), fim.getMonth() + 1, fim.getDate()) };
}

/** Períodos que fazem sentido para a data-base: o mês dela e o trimestre até ela. */
export function periodosDaDataBase(dataBase: string) {
  const [ano, mes, dia] = dataBase.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const inicioTrimestre = Math.floor((mes - 1) / 3) * 3 + 1;
  const mesDaDataBase = { dataDe: iso(ano, mes, 1), dataAte: dataBase };
  const trimestre = { dataDe: iso(ano, inicioTrimestre, 1), dataAte: dataBase };
  // Data-base no fechamento do trimestre: a auditoria amostra o trimestre inteiro.
  const fechaTrimestre = mes % 3 === 0 && dia === ultimoDia;
  return { sugerido: fechaTrimestre ? trimestre : mesDaDataBase, mes: mesDaDataBase, trimestre };
}

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

export type FundoDoLote = { id: number; nome: string; cnpj: string; administradora?: string | null };
export type ConteudoLido = { nome: string | null; cnpj: string | null };

/** Nome do fundo comparável entre arquivos e cadastro. */
export const normalizarNome = (texto: unknown) => String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^A-Za-z0-9]+/g, ' ').trim().toUpperCase();

function indicePorNome<F>(pares: [string | null | undefined, F][]): Map<string, F | null> {
  const indice = new Map<string, F | null>();
  for (const [nome, fundo] of pares) {
    if (!nome) continue;
    indice.set(nome, !indice.has(nome) || indice.get(nome) === fundo ? fundo : null);
  }
  return indice;
}

/**
 * Agrupa os arquivos por fundo (`montarLote`): pelo CNPJ no nome; sem ele, pelo que vem escrito
 * dentro do arquivo (CNPJ do fundo, ou o mesmo nome de outro arquivo do lote) e por último o nome
 * do cadastro. `escolhas` é o fundo escolhido à mão.
 */
export function montarLote<A extends ComNome, F extends FundoDoLote>(
  arquivos: A[], fundos: F[], { conteudos = new Map<A, ConteudoLido>(), escolhas = new Map<A, number>() } = {},
) {
  const porId = new Map(fundos.map((f) => [f.id, f]));
  const porCnpj = new Map(fundos.map((f) => [digitos(f.cnpj), f]));
  const porNomeCadastro = indicePorNome(fundos.map((f) => [normalizarNome(f.nome), f] as [string, F]));
  const naoReconhecidos = arquivos.filter((a) => !ehEstoque(a.name) && !ehLiquidados(a.name));
  const validos = arquivos.filter((a) => !naoReconhecidos.includes(a));

  const fundoDe = new Map<A, F>();
  for (const arquivo of validos) {
    const escolhido = escolhas.get(arquivo);
    const f = (escolhido !== undefined ? porId.get(escolhido) : undefined)
      ?? cnpjsDoNome(arquivo.name).map((c) => porCnpj.get(c)).find(Boolean)
      ?? porCnpj.get(conteudos.get(arquivo)?.cnpj ?? '');
    if (f) fundoDe.set(arquivo, f);
  }
  const porNomeNoLote = indicePorNome([...fundoDe].map(([a, f]) => [conteudos.get(a)?.nome, f] as [string | null | undefined, F]));
  const pelaLeitura = new Set<A>();
  for (const arquivo of validos) {
    const nome = conteudos.get(arquivo)?.nome;
    if (fundoDe.has(arquivo) || !nome) continue;
    const f = porNomeNoLote.has(nome) ? porNomeNoLote.get(nome) : porNomeCadastro.get(nome);
    if (f) {
      fundoDe.set(arquivo, f);
      pelaLeitura.add(arquivo);
    }
  }
  const porFundo = new Map<number, { fundo: F; arquivos: A[] }>();
  const semFundo: A[] = [];
  for (const arquivo of validos) {
    const f = fundoDe.get(arquivo);
    if (!f) {
      semFundo.push(arquivo);
      continue;
    }
    if (!porFundo.has(f.id)) porFundo.set(f.id, { fundo: f, arquivos: [] });
    porFundo.get(f.id)!.arquivos.push(arquivo);
  }
  const linhas = [...porFundo.values()]
    .map(({ fundo, arquivos: doFundo }) => ({ fundo, estoques: doFundo.filter((a) => ehEstoque(a.name)), liquidados: doFundo.filter((a) => ehLiquidados(a.name)) }))
    .sort((a, b) => a.fundo.nome.localeCompare(b.fundo.nome, 'pt-BR'));
  return { linhas, semFundo, naoReconhecidos, pelaLeitura };
}

const PALAVRAS_COMUNS = new Set(['FUNDO', 'FUNDOS', 'DE', 'DO', 'DA', 'EM', 'E', 'INVESTIMENTO', 'INVESTIMENTOS',
  'DIREITOS', 'CREDITORIOS', 'FIDC', 'FIC', 'NP', 'NAO', 'PADRONIZADO', 'PADRONIZADOS', 'RESP', 'RESPONSABILIDADE',
  'LIMITADA', 'LTDA', 'MULTISSETORIAL', 'COTAS']);
const palavras = (nome: unknown) => new Set(normalizarNome(nome).split(' ').filter((p) => p && !PALAVRAS_COMUNS.has(p)));

/** Fundos para escolher à mão: os de nome mais parecido com o lido no arquivo primeiro. */
export function fundosParecidos<F extends FundoDoLote>(nomeLido: string | null | undefined, fundos: F[]): F[] {
  const doArquivo = palavras(nomeLido);
  return fundos.map((f) => [[...palavras(f.nome)].filter((p) => doArquivo.has(p)).length, f] as const)
    .sort(([pa, a], [pb, b]) => pb - pa || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(([, f]) => f);
}

type ItemHistorico = { id: number; status: string; data_de: string; data_ate: string };

/** Amostra valendo deste fundo no mesmo período: o lote não sorteia de novo, pula. */
export const amostraDoPeriodo = <T extends ItemHistorico>(historico: T[], dataDe: string, dataAte: string) =>
  historico.find((a) => a.status === 'GERADA' && a.data_de === dataDe && a.data_ate === dataAte) ?? null;

/** A amostra anterior que a tela ofereceria: a valendo mais recente que termina antes do início. */
export function anteriorDoHistorico<T extends ItemHistorico>(historico: T[], dataDe: string): T | null {
  return historico.filter((a) => a.status === 'GERADA' && a.data_ate < dataDe).sort((a, b) => (a.data_ate < b.data_ate ? 1 : -1))[0] ?? null;
}

/** Planner quando todos os fundos do lote são de administradora Planner. */
export function regraSugerida(linhas: { fundo: FundoDoLote }[]): 'padrao' | 'planner' | null {
  if (!linhas.length) return null;
  return linhas.every((l) => /planner/i.test(l.fundo.administradora ?? '')) ? 'planner' : 'padrao';
}

const celula = (valor: unknown) => `"${String(valor ?? '').replace(/"/g, '""')}"`;

export type SituacaoLote = { estado: string; rotulo: string; amostra?: { seed: string; total_titulos: number } | null; mensagem?: string };

/** Resumo do lote em CSV (ponto e vírgula, para abrir direto no Excel). */
export function resumoCsv(linhas: { fundo: FundoDoLote }[], situacoes: Record<number, SituacaoLote>): string {
  const cabecalho = ['Fundo', 'CNPJ', 'Situação', 'Seed', 'Títulos', 'Observação'];
  const corpo = linhas.map(({ fundo }) => {
    const s = situacoes[fundo.id];
    return [fundo.nome, mascaraCnpj(digitos(fundo.cnpj)), s?.rotulo || 'Não gerada', s?.amostra?.seed, s?.amostra?.total_titulos, s?.mensagem];
  });
  return `﻿${[cabecalho, ...corpo].map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`;
}
