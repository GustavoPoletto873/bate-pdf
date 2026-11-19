import {
  chave, COLUNAS, compararTexto, documento, ErroAmostragem, type Coluna as NomeColuna, type ItemSelecionado, type TituloCanonico,
} from './selecao';
import {
  colunaData, colunaValor, dataSemFormato, ErroDeLeitura, lerCsv, lerXlsx, texto, type Coluna, type Quadro, type Valor,
} from './pandas';

/**
 * Leitura do estoque e da amostra anterior até a população canônica — porta de
 * backend/modules/amostragem/leitura.py do Bate Lastro (layouts Fromtis/ARP, conversões de data e
 * valor, validação da data-base). Saída: títulos com todos os campos em texto canônico (datas ISO,
 * valores "1234.50", vazio "-"), deduplicados pela chave e ordenados por ela.
 */

export type Arquivo = { nome: string; conteudo: Uint8Array };

export const COLUNAS_TEXTO: NomeColuna[] = ['NOME_FUNDO', 'NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO', 'DOC_SACADO', 'SEU_NUMERO', 'NU_DOCUMENTO', 'TIPO_RECEBIVEL', 'CHAVE_NFE'];
export const COLUNAS_VALOR: NomeColuna[] = ['VALOR_NOMINAL', 'VALOR_PRESENTE', 'VALOR_AQUISICAO'];
export const COLUNAS_DATA: NomeColuna[] = ['DATA_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO_AJUSTADA', 'DATA_EMISSAO', 'DATA_AQUISICAO'];

const RENOMEAR_NAO_PADRAO: Record<string, string> = {
  'Fundo': 'NOME_FUNDO', 'Nome Fundo': 'NOME_FUNDO',
  'Nome Originador': 'NOME_FUNDO',
  'Cedente': 'NOME_CEDENTE', 'Nome Cedente': 'NOME_CEDENTE',
  'CpfCnpj Cedente': 'DOC_CEDENTE', 'Cnpj Cedente': 'DOC_CEDENTE',
  'CPF Cedente': 'DOC_CEDENTE', 'CPF/CNPJ Cedente': 'DOC_CEDENTE',
  'Sacado': 'NOME_SACADO', 'Nome Sacado': 'NOME_SACADO',
  'CpfCnpj Sacado': 'DOC_SACADO', 'Cnpj Sacado': 'DOC_SACADO',
  'CPF Sacado': 'DOC_SACADO', 'CPF/CNPJ Sacado': 'DOC_SACADO',
  'Número Documento': 'NU_DOCUMENTO', 'Numero Documento': 'NU_DOCUMENTO',
  'Número Doc': 'NU_DOCUMENTO', 'Numero Doc': 'NU_DOCUMENTO',
  'Seu Número': 'SEU_NUMERO', 'Seu Numero': 'SEU_NUMERO',
  'Título': 'SEU_NUMERO', 'Titulo': 'SEU_NUMERO',
  'Tipo Título': 'TIPO_RECEBIVEL', 'Tipo Titulo': 'TIPO_RECEBIVEL', 'Tipo NF': 'TIPO_RECEBIVEL',
  'Tipo Recebível': 'TIPO_RECEBIVEL', 'Tipo': 'TIPO_RECEBIVEL',
  'Valor Nominal': 'VALOR_NOMINAL', 'Valor Aquisição': 'VALOR_AQUISICAO',
  'Valor Aquisicao': 'VALOR_AQUISICAO', 'Valor Presente': 'VALOR_PRESENTE',
  'Valor Presente REC': 'VALOR_PRESENTE', 'Valor Pago': 'VALOR_PRESENTE',
  'Data Emissão Título': 'DATA_EMISSAO', 'Data Emissao Titulo': 'DATA_EMISSAO',
  'Data Emissão': 'DATA_EMISSAO', 'Data Emissao': 'DATA_EMISSAO',
  'Data Aquisição Título': 'DATA_AQUISICAO', 'Data Aquisicao Titulo': 'DATA_AQUISICAO',
  'Data Aquisição': 'DATA_AQUISICAO', 'Data Aquisicao': 'DATA_AQUISICAO',
  'Data Vencimento': 'DATA_VENCIMENTO_ORIGINAL',
  'Data Vencimento Original': 'DATA_VENCIMENTO_ORIGINAL',
  'Data Vencimento Ajustada': 'DATA_VENCIMENTO_AJUSTADA',
  'NFE': 'CHAVE_NFE', 'Chave NFe': 'CHAVE_NFE', 'Chave NF-e': 'CHAVE_NFE', 'Chave Nfe': 'CHAVE_NFE',
};

const RENOMEAR_PADRAO: Record<string, string> = {
  'FUNDO': 'NOME_FUNDO', 'CEDENTE': 'NOME_CEDENTE', 'IDENTIFICACAO_CEDENTE': 'DOC_CEDENTE',
  'SACADO': 'NOME_SACADO', 'IDENTIFICACAO_SACADO': 'DOC_SACADO', 'DOCUMENTO': 'NU_DOCUMENTO',
  'CPF_CNPJ_CEDENTE': 'DOC_CEDENTE', 'CPF_CNPJ_SACADO': 'DOC_SACADO',
  'DATA_VENCIMENTO': 'DATA_VENCIMENTO_ORIGINAL', 'VL_AQUISICAO': 'VALOR_AQUISICAO',
  'VALOR_VENCIMENTO': 'VALOR_NOMINAL', 'VALOR_PAGO': 'VALOR_PRESENTE',
  'ï»¿NOME_FUNDO': 'NOME_FUNDO',
};

export const COLUNAS_REFERENCIA = ['DATA_REFERENCIA', 'Data Referência', 'Data Referencia', 'DATA_FUNDO'];
const MESES: Record<string, string> = { jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06', jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12' };
const RE_MESES = new RegExp(`(?<![\\p{L}\\p{N}_])(${Object.keys(MESES).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');

const coluna = (q: Quadro, nome: string) => q.colunas.find((c) => c.nome === nome);

/** `ler_planilha`: CSV (;, latin1, tudo texto) ou XLSX (openpyxl). */
export async function lerPlanilha(arquivo: Arquivo): Promise<Quadro> {
  const extensao = arquivo.nome.includes('.') ? arquivo.nome.split('.').pop()!.toLowerCase() : '';
  if (extensao !== 'csv' && extensao !== 'xlsx') throw new ErroAmostragem(`${arquivo.nome}: envie somente arquivos CSV ou XLSX.`);
  try {
    return extensao === 'csv' ? lerCsv(arquivo.conteudo) : await lerXlsx(arquivo.conteudo);
  } catch (e) {
    if (!(e instanceof ErroDeLeitura) && !(e instanceof Error)) throw e;
    throw new ErroAmostragem(`${arquivo.nome}: não foi possível ler o arquivo. Confira se está íntegro, sem senha, e se o CSV usa ponto e vírgula.`);
  }
}

function renomear(q: Quadro, mapa: Record<string, string>): Quadro {
  return { ...q, colunas: q.colunas.map((c) => (mapa[c.nome] ? { ...c, nome: mapa[c.nome] } : c)) };
}

/** `normalizar_colunas`: renomeia, tira repetidas (fica a primeira), copia o vencimento original para o ajustado. */
export function normalizarColunas(quadro: Quadro): Quadro {
  let q = renomear(renomear(quadro, RENOMEAR_NAO_PADRAO), RENOMEAR_PADRAO);
  const vistas = new Set<string>();
  q = { ...q, colunas: q.colunas.filter((c) => (vistas.has(c.nome) ? false : (vistas.add(c.nome), true))) };
  const original = coluna(q, 'DATA_VENCIMENTO_ORIGINAL');
  if (!coluna(q, 'DATA_VENCIMENTO_AJUSTADA') && original) q.colunas.push({ ...original, nome: 'DATA_VENCIMENTO_AJUSTADA' });
  return q;
}

const vazio = (q: Quadro) => q.linhas === 0 || q.colunas.length === 0;

export function validarLayout(q: Quadro, nome: string): void {
  if (vazio(q)) return;
  const faltantes = ['DOC_CEDENTE', 'VALOR_PRESENTE'].filter((c) => !coluna(q, c));
  if (!coluna(q, 'NU_DOCUMENTO') && !coluna(q, 'SEU_NUMERO')) faltantes.push('NU_DOCUMENTO ou SEU_NUMERO');
  if (faltantes.length) {
    throw new ErroAmostragem(`${nome}: layout não reconhecido. Colunas obrigatórias ausentes: ${faltantes.join(', ')}. Confira o relatório enviado.`);
  }
}

function mesesEmNumero(textoData: string): string {
  return textoData.toLowerCase().replace(RE_MESES, (m) => MESES[m]);
}

/** Texto de um valor da coluna de data-base como o `astype(str)` do pandas. */
function textoDaReferencia(v: Valor): string {
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  return typeof v === 'string' ? v : texto(v);
}

/** `data_base`: maior data de referência do estoque (ISO), se ele tiver a coluna. */
export function dataBase(q: Quadro): string | null {
  const col = COLUNAS_REFERENCIA.map((c) => coluna(q, c)).find(Boolean);
  if (!col || vazio(q)) return null;
  let maior: string | null = null;
  for (const v of new Set(col.valores.filter((x) => x !== null).map(textoDaReferencia))) {
    const d = dataSemFormato(mesesEmNumero(v));
    if (d && (!maior || d > maior)) maior = d;
  }
  return maior;
}

/** `canonizar`: as 16 COLUNAS em texto canônico. */
export function canonizar(q: Quadro): TituloCanonico[] {
  const por: Record<string, string[]> = {};
  for (const nome of COLUNAS) {
    const c = coluna(q, nome);
    if (COLUNAS_VALOR.includes(nome)) por[nome] = colunaValor(c, q.linhas);
    else if (COLUNAS_DATA.includes(nome)) por[nome] = colunaData(c, q.linhas);
    else por[nome] = c ? c.valores.map(texto) : Array(q.linhas).fill('-');
  }
  return Array.from({ length: q.linhas }, (_, i) => Object.fromEntries(COLUNAS.map((c) => [c, por[c][i]])) as TituloCanonico);
}

/** `deduplicar`: um título por chave (o de maior VALOR_PRESENTE), ordenado pela chave e depois por todas as colunas. */
export function deduplicar(titulos: TituloCanonico[]): TituloCanonico[] {
  const comChave = titulos.map((t) => ({ t, k: chave(t), c: BigInt(t.VALOR_PRESENTE.replace('.', '')) }));
  comChave.sort((a, b) => {
    const k = compararTexto(a.k, b.k);
    if (k) return k;
    if (a.c !== b.c) return a.c > b.c ? -1 : 1;
    for (const col of COLUNAS) {
      const r = compararTexto(a.t[col], b.t[col]);
      if (r) return r;
    }
    return 0;
  });
  const saida: TituloCanonico[] = [];
  let anterior: string | null = null;
  for (const { t, k } of comChave) {
    if (k !== anterior) saida.push(t);
    anterior = k;
  }
  return saida;
}

function dataBr(isoData: string) {
  return isoData.split('-').reverse().join('/');
}

/** `ler_estoques`: população canônica e avisos. */
export async function lerEstoques(estoques: Arquivo[], dataDe: string, dataAte: string, maioresCedentes = true): Promise<{ populacao: TituloCanonico[]; avisos: string[]; dataBase: string | null }> {
  const titulos: TituloCanonico[] = [];
  const referencias: [string, string][] = [];
  const avisos: string[] = [];
  for (const arquivo of estoques) {
    const q = normalizarColunas(await lerPlanilha(arquivo));
    if (coluna(q, 'TIPO_MOVIMENTO') || coluna(q, 'Tipo Baixa')) {
      throw new ErroAmostragem(`${arquivo.nome}: o arquivo tem tipo de movimento, como um relatório de liquidados. Se for de liquidados, o nome precisa ter "Liquidados" ou "Movimentações".`);
    }
    validarLayout(q, arquivo.nome);
    const ref = dataBase(q);
    if (ref) referencias.push([ref, arquivo.nome]);
    titulos.push(...canonizar(q));
  }
  let referencia: string | null = null;
  if (referencias.length) {
    const [ref, nome] = referencias.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a));
    referencia = ref;
    for (const [rotulo, selecionada] of [['início', dataDe], ['fim', dataAte]] as const) {
      if (selecionada > ref) {
        throw new ErroAmostragem(`A data de ${rotulo} (${dataBr(selecionada)}) é posterior à data-base do estoque (${dataBr(ref)}), identificada em ${nome}. Escolha um período até essa data ou envie insumos mais recentes.`);
      }
    }
  }
  const populacao = deduplicar(titulos);
  if (populacao.length) {
    const temAquisicoes = populacao.some((t) => t.DATA_AQUISICAO >= dataDe && t.DATA_AQUISICAO <= dataAte);
    const temVencimentos = populacao.some((t) => t.DATA_VENCIMENTO_AJUSTADA > dataDe && t.DATA_VENCIMENTO_AJUSTADA <= dataAte);
    if (!temAquisicoes && !temVencimentos) {
      const periodo = `Nenhum título do estoque foi adquirido ou venceu entre ${dataBr(dataDe)} e ${dataBr(dataAte)}`;
      avisos.push(maioresCedentes
        ? `${periodo}. O grupo Maiores Cedentes não é filtrado por período e pode continuar na amostra.`
        : `${periodo}: o sorteio fica vazio e entram só as pendências dos trimestres anteriores.`);
    }
    for (const c of ['DATA_AQUISICAO', 'DATA_VENCIMENTO_AJUSTADA'] as const) {
      if (populacao.every((t) => t[c] === '')) avisos.push(`O estoque não tem datas válidas em ${c}; esse filtro não poderá selecionar títulos.`);
    }
  }
  return { populacao, avisos, dataBase: referencia };
}

const VALORES_PAGOS = ['VALOR_PAGO', 'Valor Pago'];

/** `ler_liquidados`: só as recompras, na população canônica. */
export async function lerLiquidados(liquidados: Arquivo[]): Promise<{ recompras: TituloCanonico[]; avisos: string[] }> {
  const titulos: TituloCanonico[] = [];
  let algum = false;
  for (const arquivo of liquidados) {
    let q = await lerPlanilha(arquivo);
    if (q.colunas.some((c) => VALORES_PAGOS.includes(c.nome))) {
      q = { ...q, colunas: q.colunas.filter((c) => !['VALOR_PRESENTE', 'Valor Presente', 'Valor Presente REC'].includes(c.nome)) };
    }
    if (coluna(q, 'VALOR_VENCIMENTO')) q = { ...q, colunas: q.colunas.filter((c) => c.nome !== 'VALOR_NOMINAL') };
    q = normalizarColunas(renomear(q, { 'Tipo Baixa': 'TIPO_MOVIMENTO' }));
    validarLayout(q, arquivo.nome);
    if (vazio(q)) continue;
    const tipo = coluna(q, 'TIPO_MOVIMENTO');
    if (!tipo) {
      throw new ErroAmostragem(`${arquivo.nome}: o arquivo de liquidados não tem a coluna do tipo de movimento (TIPO_MOVIMENTO ou Tipo Baixa). Sem ela não dá para separar as recompras.`);
    }
    const manter = tipo.valores.map((v) => v !== null && (typeof v === 'string' ? v : texto(v)).toUpperCase().includes('RECOMPRA'));
    const filtrar = (c: Coluna): Coluna => {
      const valores = c.valores.filter((_, i) => manter[i]);
      if (COLUNAS_DATA.includes(c.nome as NomeColuna)) return { ...c, valores: valores.map((v) => (typeof v === 'string' ? mesesEmNumero(v) : v)) };
      return { ...c, valores };
    };
    q = { colunas: q.colunas.map(filtrar), linhas: manter.filter(Boolean).length };
    algum = true;
    titulos.push(...canonizar(q));
  }
  const recompras = algum ? deduplicar(titulos) : [];
  return { recompras, avisos: recompras.length ? [] : ['Não há recompras nos liquidados enviados: eles não entram na amostra.'] };
}

/** `populacao_csv`: UTF-8, vírgula, LF, aspas só quando precisa (csv.QUOTE_MINIMAL). */
export function populacaoCsv(populacao: TituloCanonico[]): Uint8Array {
  const celula = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const linhas = [COLUNAS.join(','), ...populacao.map((t) => COLUNAS.map((c) => celula(t[c])).join(','))];
  return new TextEncoder().encode(linhas.map((l) => `${l}\n`).join(''));
}

/** `ler_chaves_anteriores`: chaves dos títulos da amostra anterior (com a variante "CCB"). */
export async function lerChavesAnteriores(arquivo: Arquivo): Promise<string[]> {
  const q = normalizarColunas(await lerPlanilha(arquivo));
  if (vazio(q)) return [];
  const doc = coluna(q, 'DOC_CEDENTE'), numero = coluna(q, 'NU_DOCUMENTO'), seu = coluna(q, 'SEU_NUMERO');
  if (!doc || !numero || !seu) {
    throw new ErroAmostragem('A amostra anterior precisa das colunas DOC_CEDENTE, NU_DOCUMENTO e SEU_NUMERO para identificar os títulos já selecionados.');
  }
  const tipo = coluna(q, 'TIPO_RECEBIVEL');
  const chaves = new Set<string>();
  for (let i = 0; i < q.linhas; i++) {
    const t = { DOC_CEDENTE: texto(doc.valores[i]), NU_DOCUMENTO: texto(numero.valores[i]), SEU_NUMERO: texto(seu.valores[i]) };
    chaves.add(chave(t));
    const tipoTexto = tipo ? texto(tipo.valores[i]) : '';
    if (tipoTexto.toUpperCase() === 'CCB' && t.SEU_NUMERO === t.NU_DOCUMENTO) chaves.add(chave({ ...t, SEU_NUMERO: 'CCB' }));
  }
  return [...chaves].sort(compararTexto);
}

/** Linha da planilha da amostra (`para_planilha`): valores como número, datas ISO (ou null) e o grupo. */
export type LinhaPlanilha = Record<string, string | number | null>;

export function paraPlanilha(selecao: ItemSelecionado[], nomeFundo = ''): LinhaPlanilha[] {
  return selecao.map((item) => {
    const t: Record<string, string> = { ...item.titulo };
    if (t.SEU_NUMERO.trim().toUpperCase() === 'CCB') {
      t.TIPO_RECEBIVEL = 'CCB';
      t.SEU_NUMERO = t.NU_DOCUMENTO;
    }
    if (nomeFundo) t.NOME_FUNDO = nomeFundo;
    const linha: LinhaPlanilha = {};
    for (const c of COLUNAS) {
      if (COLUNAS_VALOR.includes(c)) linha[c] = Number(t[c]);
      else if (COLUNAS_DATA.includes(c)) linha[c] = t[c] || null;
      else linha[c] = t[c];
    }
    linha.RELATORIO = item.grupo;
    return linha;
  });
}

export { documento };
