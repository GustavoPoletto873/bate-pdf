import ExcelJS from 'exceljs';
import type { Lado, TituloAmostra } from '@/lib/campos';
import { lerData, lerMoeda } from '@/lib/valores';

/**
 * Lê a planilha que dá origem a uma base local. Dois formatos:
 *
 * 1. `resultados_matching_<CNPJ>_*.xlsx` exportado em Resultados do Bate Lastro
 *    (abas TERMO e LASTRO, cabeçalho com ID_BASE e STATUS). STATUS diferente de
 *    V = pendência daquele lado. É o melhor ponto de partida: traz o ID_BASE,
 *    e a volta para o Bate Lastro acha o título direto.
 * 2. A amostra do fundo (a mesma planilha que sobe no upload da base). As
 *    colunas são reconhecidas pelo mesmo mapeamento do upload
 *    (mapeamento_inteligente em base_direito_creditorio.py). Sem ID_BASE, a volta
 *    acha o título por nº do documento + valor.
 */

export type SituacaoLado = 'pendente' | 'ja_batido';

export type TituloImportado = TituloAmostra & {
  linha_origem: number;
  id_base_origem: number | null;
  lados: Partial<Record<Lado, SituacaoLado>>;
};

export type ResultadoImportacao = {
  formato: 'resultados_matching' | 'amostra';
  titulos: TituloImportado[];
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  /** coluna do arquivo → campo, quando a amostra foi mapeada. */
  mapeamento: Record<string, string>;
  avisos: string[];
};

export class PlanilhaRecusada extends Error {}

/** Uma linha crua da planilha (células na ordem das colunas). */
export type Linha = unknown[];
/** Uma aba crua: `linhas[i]` é a linha i + 1 do Excel (linhas vazias viram []). */
export type Aba = { nome: string; linhas: Linha[] };

// ---------------------------------------------------------------------------
// Leitura crua (xlsx / csv)
// ---------------------------------------------------------------------------

function valorDaCelula(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return valorDaCelula(o.result as ExcelJS.CellValue);
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((p) => p.text).join('');
    }
    if ('text' in o) return o.text;
    if ('error' in o) return null;
    return null;
  }
  return v;
}

async function lerXlsx(conteudo: Uint8Array): Promise<Aba[]> {
  const livro = new ExcelJS.Workbook();
  try {
    await livro.xlsx.load(conteudo.buffer.slice(conteudo.byteOffset, conteudo.byteOffset + conteudo.byteLength) as ArrayBuffer);
  } catch {
    throw new PlanilhaRecusada(
      'Não foi possível abrir a planilha. Envie um arquivo .xlsx (o .xls antigo não é aceito: abra no Excel e salve como .xlsx) ou .csv.',
    );
  }
  const abas: Aba[] = [];
  livro.eachSheet((planilha) => {
    const linhas: Linha[] = [];
    planilha.eachRow({ includeEmpty: true }, (linha, numero) => {
      const valores = (linha.values as ExcelJS.CellValue[]).slice(1).map(valorDaCelula);
      linhas[numero - 1] = valores;
    });
    for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
    abas.push({ nome: planilha.name, linhas });
  });
  return abas;
}

function lerCsv(conteudo: Uint8Array): Aba[] {
  let texto = new TextDecoder('utf-8').decode(conteudo);
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(conteudo);
  texto = texto.replace(/^﻿/, '');
  const primeira = texto.slice(0, texto.indexOf('\n') === -1 ? undefined : texto.indexOf('\n'));
  const conta = (c: string) => primeira.split(c).length - 1;
  // Como o csv.Sniffer do Bate Lastro: ponto e vírgula (Excel em português), vírgula ou tabulação.
  const separador = conta('\t') > Math.max(conta(';'), conta(',')) ? '\t' : conta(';') >= conta(',') ? ';' : ',';
  const linhas: Linha[] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return [{ nome: 'CSV', linhas }];
}

/**
 * Lê as abas cruas de um .xlsx ou .csv (o .csv vira uma aba só, "CSV"). Usado também pelo
 * Upload Base e pela importação de fundos, que interpretam o cabeçalho cada um do seu jeito.
 */
export async function lerAbas(conteudo: Uint8Array, nomeArquivo: string): Promise<Aba[]> {
  return /\.(csv|txt)$/i.test(nomeArquivo) ? lerCsv(conteudo) : lerXlsx(conteudo);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Célula → texto aparado (inteiro sem ".0", data como AAAA-MM-DD), ou null se vazia. */
export function textoDaCelula(v: unknown, limite?: number): string | null {
  return texto(v, limite);
}

function texto(v: unknown, limite?: number): string | null {
  if (v === null || v === undefined) return null;
  let t: string;
  if (typeof v === 'number' && Number.isInteger(v)) t = String(v);
  else if (v instanceof Date) t = v.toISOString().slice(0, 10);
  else t = String(v);
  t = t.trim();
  if (!t) return null;
  return limite ? t.slice(0, limite) : t;
}

function inteiro(v: unknown): number | null {
  const t = texto(v);
  if (!t || !/^\d+(\.0+)?$/.test(t)) return null;
  return Number.parseInt(t, 10);
}

function cnpj(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 14 ? d : null;
}

// ---------------------------------------------------------------------------
// Formato 1: resultados_matching
// ---------------------------------------------------------------------------

const ABAS_RESULTADO: Record<string, Lado> = { TERMO: 'termo', LASTRO: 'lastro' };

function cabecalhoComIdBase(linhas: Linha[]): { indice: Map<string, number>; linha: number } | null {
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const nomes = linhas[i].map((v) => texto(v));
    if (nomes.includes('ID_BASE')) {
      const indice = new Map<string, number>();
      nomes.forEach((n, j) => { if (n && !indice.has(n)) indice.set(n, j); });
      return { indice, linha: i };
    }
  }
  return null;
}

function importarResultadoMatching(abas: Aba[], nomeArquivo: string): ResultadoImportacao {
  const avisos: string[] = [];
  const cnpjs = new Set<string>();
  const doNome = /resultados_matching_(\d{14})_/.exec(nomeArquivo);
  if (doNome) cnpjs.add(doNome[1]);

  const porId = new Map<string, TituloImportado>();
  let nomeFundo: string | null = null;

  for (const aba of abas) {
    const lado = ABAS_RESULTADO[aba.nome.trim().toUpperCase()];
    if (!lado) continue;
    const cab = cabecalhoComIdBase(aba.linhas);
    if (!cab || !cab.indice.has('STATUS')) {
      throw new PlanilhaRecusada(`A aba ${aba.nome} não tem as colunas ID_BASE e STATUS.`);
    }
    const col = (linha: Linha, nome: string) => {
      const i = cab.indice.get(nome);
      return i === undefined ? null : linha[i];
    };
    for (let n = cab.linha + 1; n < aba.linhas.length; n++) {
      const linha = aba.linhas[n];
      const idBase = inteiro(col(linha, 'ID_BASE'));
      const numero = texto(col(linha, 'BASE_NUMERO_DOC'), 100);
      if (idBase === null && !numero) continue;
      const fundoCnpj = cnpj(col(linha, 'BASE_CNPJ_FUNDO'));
      if (fundoCnpj) cnpjs.add(fundoCnpj);
      const fundoNome = texto(col(linha, 'BASE_NOME_FUNDO'));
      if (fundoNome && !nomeFundo) nomeFundo = fundoNome;

      const chave = idBase !== null ? `id:${idBase}` : `n:${numero}:${texto(col(linha, 'BASE_VALOR_NOMINAL'))}`;
      let t = porId.get(chave);
      if (!t) {
        t = {
          linha_origem: n + 1,
          id_base_origem: idBase,
          numero_documento: numero,
          sacado_nome: texto(col(linha, 'BASE_NOME_SACADO'), 255),
          sacado_documento: texto(col(linha, 'BASE_DOC_SACADO'), 50),
          cedente_nome: texto(col(linha, 'BASE_NOME_CEDENTE'), 255),
          cedente_documento: texto(col(linha, 'BASE_DOC_CEDENTE'), 50),
          valor_total: lerMoeda(col(linha, 'BASE_VALOR_NOMINAL')),
          valor_aquisicao: lerMoeda(col(linha, 'BASE_VALOR_AQUISICAO')),
          data_emissao: lerData(col(linha, 'BASE_DATA_EMISSAO')),
          data_vencimento: lerData(col(linha, 'BASE_DATA_VENCIMENTO')),
          data_aquisicao: lerData(col(linha, 'BASE_DATA_AQUISICAO')),
          nome_fundo: fundoNome,
          cnpj_fundo: texto(col(linha, 'BASE_CNPJ_FUNDO')),
          tipo_recebivel: texto(col(linha, 'BASE_TIPO_RECEBIVEL')),
          chave_nfe: texto(col(linha, 'BASE_CHAVE_NFE')),
          lados: {},
        };
        porId.set(chave, t);
      } else {
        // A aba TERMO traz fundo/aquisição que a LASTRO não tem.
        t.nome_fundo ??= fundoNome;
        t.cnpj_fundo ??= texto(col(linha, 'BASE_CNPJ_FUNDO'));
        t.data_aquisicao ??= lerData(col(linha, 'BASE_DATA_AQUISICAO'));
      }
      const status = (texto(col(linha, 'STATUS')) ?? '').toUpperCase();
      t.lados[lado] = status === 'V' ? 'ja_batido' : 'pendente';
    }
  }

  if (cnpjs.size > 1) {
    avisos.push(`A planilha cita mais de um CNPJ de fundo (${[...cnpjs].join(', ')}). Confira se é o arquivo certo.`);
  }
  const titulos = [...porId.values()];
  const nomeFundoFinal = nomeFundo ?? titulos.find((t) => t.nome_fundo)?.nome_fundo ?? null;
  // A aba LASTRO não traz o fundo: completa pelo da planilha.
  for (const t of titulos) {
    t.nome_fundo ??= nomeFundoFinal;
    t.cnpj_fundo ??= [...cnpjs][0] ?? null;
  }
  return {
    formato: 'resultados_matching',
    titulos,
    nome_fundo: nomeFundoFinal,
    cnpj_fundo: [...cnpjs][0] ?? null,
    mapeamento: {},
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Formato 2: amostra do fundo
// ---------------------------------------------------------------------------

const CONECTORES = new Set(['de', 'do', 'da', 'dos', 'das']);

/** Minúsculo, sem acento, sem pontuação e sem conectores (_normalizar_nome_coluna). */
export function normalizarNomeColuna(nome: string): string {
  const semAcento = String(nome).normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
  return semAcento
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !CONECTORES.has(p))
    .join('');
}

export const COLUNAS_PADRAO = [
  'NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO', 'DOC_SACADO', 'NU_DOCUMENTO', 'TIPO_RECEBIVEL',
  'DATA_AQUISICAO', 'DATA_EMISSAO', 'DATA_VENCIMENTO_ORIGINAL', 'VALOR_NOMINAL', 'VALOR_AQUISICAO', 'CHAVE_NFE',
  // Fora do upload do Bate Lastro (lá vêm do formulário), mas aceitas se a planilha trouxer.
  'NOME_FUNDO', 'CNPJ_FUNDO',
] as const;

const PALAVRAS_CHAVE: Record<string, string[]> = {
  NOME_CEDENTE: ['nome_cedente', 'cedente', 'credor', 'emitente', 'cessionario', 'razao_social_cedente', 'cedentenome', 'nome cedente'],
  DOC_CEDENTE: ['doc_cedente', 'cpf_cnpj_cedente', 'cpf_cedente', 'cnpj_cedente', 'documento_cedente', 'inscricao_cedente', 'identificacao_cedente', 'cedentecnpjcpf', 'doc cedente'],
  NOME_SACADO: ['nome_sacado', 'sacado', 'devedor', 'pagador', 'razao_social_sacado', 'sacadonome', 'nome sacado'],
  DOC_SACADO: ['doc_sacado', 'cpf_cnpj_sacado', 'cpf_sacado', 'cnpj_sacado', 'documento_sacado', 'inscricao_sacado', 'identificacao_sacado', 'sacadocnpjcpf', 'doc sacado'],
  NU_DOCUMENTO: ['nu_documento', 'numero_documento', 'numero_duplicata', 'seu_numero', 'numero_titulo', 'numerotitulo', 'numero documento', 'numero_doc', 'num_doc', 'nr_doc', 'nro_doc', 'n_documento', 'no_documento', 'num_titulo', 'nr_titulo', 'no_titulo', 'numero_contrato', 'num_contrato', 'nr_contrato'],
  TIPO_RECEBIVEL: ['tipo_recebivel', 'tipo', 'categoria', 'especie', 'tipo_documento', 'tipoativo', 'tipo recebivel'],
  DATA_AQUISICAO: ['data_aquisicao', 'dt_aquisicao', 'data_compra', 'dataaquisicao', 'data aquisicao'],
  DATA_EMISSAO: ['data_emissao', 'dt_emissao', 'data_geracao', 'dataemissao', 'data emissao'],
  DATA_VENCIMENTO_ORIGINAL: ['data_vencimento_original', 'data_vencimento', 'dt_vencimento', 'vencimento', 'datavencimento', 'data vencimento original'],
  VALOR_NOMINAL: ['valor_nominal', 'vlr_nominal', 'valor_titulo', 'valor_documento', 'valornominaloriginal', 'valor_vencimento', 'vencimento', 'valor nominal', 'valor vencimento'],
  VALOR_AQUISICAO: ['valor_aquisicao', 'vlr_aquisicao', 'valor_compra', 'preco_aquisicao', 'valoraquisicao', 'valor aquisicao', 'valor compra'],
  CHAVE_NFE: ['chave_nfe', 'nfe', 'numero_nfe', 'chave nfe'],
  NOME_FUNDO: ['nome_fundo', 'fundo', 'nome fundo'],
  CNPJ_FUNDO: ['cnpj_fundo', 'cnpj fundo', 'doc_fundo'],
};

/**
 * Porta de mapeamento_inteligente: coluna do arquivo → coluna padrão. `colunasPadrao` são os
 * destinos possíveis, na ordem em que cada um escolhe a sua coluna (o Upload Base passa as 12 do
 * Bate Lastro; a importação de amostra aceita também NOME_FUNDO e CNPJ_FUNDO, no fim da lista).
 */
export function mapeamentoInteligente(
  colunasArquivo: string[],
  colunasPadrao: readonly string[] = COLUNAS_PADRAO,
): Record<string, string> {
  const mapeamento: Record<string, string> = {};
  const usadas = new Set<string>();
  for (const coluna of colunasArquivo) {
    if (colunasPadrao.includes(coluna) && !usadas.has(coluna)) {
      mapeamento[coluna] = coluna;
      usadas.add(coluna);
    }
  }
  const restantes = colunasArquivo.filter((c) => !usadas.has(c));
  for (const padrao of colunasPadrao) {
    if (Object.values(mapeamento).includes(padrao)) continue;
    let melhor: string | null = null;
    let maior = 0;
    for (const coluna of restantes) {
      if (usadas.has(coluna)) continue;
      const norm = normalizarNomeColuna(coluna);
      if ((padrao === 'NOME_CEDENTE' || padrao === 'NOME_SACADO') && (norm.includes('cpf') || norm.includes('cnpj'))) continue;
      let score = 0;
      if (coluna.toLowerCase() === padrao.toLowerCase()) score = 100;
      else {
        PALAVRAS_CHAVE[padrao]?.forEach((palavra, indice) => {
          const p = normalizarNomeColuna(palavra);
          if (p === norm) score = Math.max(score, 50 - indice);
          else if (norm.includes(p)) score = Math.max(score, 10);
        });
      }
      if (score > maior) { maior = score; melhor = coluna; }
    }
    if (melhor && maior > 0) {
      mapeamento[melhor] = padrao;
      usadas.add(melhor);
    }
  }
  return mapeamento;
}

/** Colunas de vencimento alternativas (original × ajustada), como colunas_de_vencimento. */
export function colunasDeVencimento(colunas: string[]): string[] {
  return colunas.filter((c) => {
    const n = normalizarNomeColuna(c);
    return n.includes('vencimento') && (n.includes('original') || n.includes('ajustad')) && !n.includes('valor');
  });
}

function importarAmostra(abas: Aba[], mapeamentoInformado?: Record<string, string>): ResultadoImportacao {
  const avisos: string[] = [];
  // A aba com mais linhas preenchidas é a amostra.
  const aba = [...abas].sort((a, b) => b.linhas.length - a.linhas.length)[0];
  if (!aba || aba.linhas.length === 0) throw new PlanilhaRecusada('A planilha está vazia.');

  // Cabeçalho: a primeira linha (até a 10ª) com mais colunas reconhecidas.
  let melhorLinha = -1;
  let melhorMapa: Record<string, string> = {};
  let melhorNomes: string[] = [];
  for (let i = 0; i < Math.min(aba.linhas.length, 10); i++) {
    const nomes = aba.linhas[i].map((v) => texto(v) ?? '');
    const mapa = mapeamentoInformado ?? mapeamentoInteligente(nomes.filter(Boolean));
    const reconhecidas = Object.keys(mapa).filter((n) => nomes.includes(n)).length;
    if (reconhecidas > Object.keys(melhorMapa).length) {
      melhorLinha = i;
      melhorMapa = Object.fromEntries(Object.entries(mapa).filter(([n]) => nomes.includes(n)));
      melhorNomes = nomes;
    }
  }
  const campos = new Set(Object.values(melhorMapa));
  if (melhorLinha < 0 || !campos.has('NU_DOCUMENTO')) {
    throw new PlanilhaRecusada(
      'Não achei a coluna do número do documento na planilha. Use o resultados_matching exportado do Bate Lastro ou a amostra com cabeçalho (NU_DOCUMENTO, NOME_SACADO, DOC_SACADO, VALOR_NOMINAL...).',
    );
  }
  for (const essencial of ['DOC_SACADO', 'VALOR_NOMINAL']) {
    if (!campos.has(essencial)) avisos.push(`A planilha não tem a coluna ${essencial}; a conferência desse campo fica sem valor da amostra.`);
  }

  const indice = new Map<string, number>();
  for (const [coluna, padrao] of Object.entries(melhorMapa)) indice.set(padrao, melhorNomes.indexOf(coluna));
  // Vencimento: quando a coluna escolhida está vazia na linha, vale a outra (original × ajustada).
  const colVenc = indice.get('DATA_VENCIMENTO_ORIGINAL');
  const alternativas = colunasDeVencimento(melhorNomes)
    .map((c) => melhorNomes.indexOf(c))
    .filter((i) => i !== colVenc);

  const col = (linha: Linha, padrao: string) => {
    const i = indice.get(padrao);
    return i === undefined ? null : linha[i];
  };
  const titulos: TituloImportado[] = [];
  for (let n = melhorLinha + 1; n < aba.linhas.length; n++) {
    const linha = aba.linhas[n];
    const numero = texto(col(linha, 'NU_DOCUMENTO'), 100);
    const sacado = texto(col(linha, 'NOME_SACADO'));
    if (!numero && !sacado) continue;
    let vencimento = lerData(col(linha, 'DATA_VENCIMENTO_ORIGINAL'));
    for (const alt of alternativas) {
      if (vencimento) break;
      vencimento = lerData(linha[alt]);
    }
    titulos.push({
      linha_origem: n + 1,
      id_base_origem: null,
      numero_documento: numero,
      sacado_nome: texto(col(linha, 'NOME_SACADO'), 255),
      sacado_documento: texto(col(linha, 'DOC_SACADO'), 50),
      cedente_nome: texto(col(linha, 'NOME_CEDENTE'), 255),
      cedente_documento: texto(col(linha, 'DOC_CEDENTE'), 50),
      valor_total: lerMoeda(col(linha, 'VALOR_NOMINAL')),
      valor_aquisicao: lerMoeda(col(linha, 'VALOR_AQUISICAO')),
      data_emissao: lerData(col(linha, 'DATA_EMISSAO')),
      data_vencimento: vencimento,
      data_aquisicao: lerData(col(linha, 'DATA_AQUISICAO')),
      nome_fundo: texto(col(linha, 'NOME_FUNDO')),
      cnpj_fundo: texto(col(linha, 'CNPJ_FUNDO')),
      tipo_recebivel: texto(col(linha, 'TIPO_RECEBIVEL')),
      chave_nfe: texto(col(linha, 'CHAVE_NFE')),
      lados: { termo: 'pendente', lastro: 'pendente' },
    });
  }
  if (!titulos.length) throw new PlanilhaRecusada('A planilha não tem nenhum título abaixo do cabeçalho.');
  return {
    formato: 'amostra',
    titulos,
    nome_fundo: titulos.find((t) => t.nome_fundo)?.nome_fundo ?? null,
    cnpj_fundo: cnpj(titulos.find((t) => t.cnpj_fundo)?.cnpj_fundo) ?? null,
    mapeamento: melhorMapa,
    avisos,
  };
}

// ---------------------------------------------------------------------------

export async function lerPlanilha(
  conteudo: Uint8Array,
  nomeArquivo: string,
  mapeamento?: Record<string, string>,
): Promise<ResultadoImportacao> {
  const abas = await lerAbas(conteudo, nomeArquivo);
  const nomesAbas = abas.map((a) => a.nome.trim().toUpperCase());
  const ehResultado = nomesAbas.some((n) => n in ABAS_RESULTADO)
    && abas.some((a) => a.nome.trim().toUpperCase() in ABAS_RESULTADO && cabecalhoComIdBase(a.linhas));
  return ehResultado ? importarResultadoMatching(abas, nomeArquivo) : importarAmostra(abas, mapeamento);
}
