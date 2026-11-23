import { db } from '@/lib/db';
import type { Leitura } from '@/lib/leituras';

/**
 * Análise › Visualizar (routes/get/leitura.py + modules/registro_leitura.coleta_leituras_com_filtros
 * do Bate Lastro): leituras com filtros parciais (sem diferenciar maiúsculas e acentos;
 * documento comparado só pelos dígitos), datas por intervalo, ordenação e páginas de 15.
 */

export type FiltrosLeituras = {
  nome_cessionario?: string;
  doc_cessionario?: string;
  nome_sacado?: string;
  doc_sacado?: string;
  nome_cedente?: string;
  doc_cedente?: string;
  numero_documento?: string;
  base?: string;
  tipo_recebivel?: string;
  aquisicao_de?: string;
  aquisicao_ate?: string;
  emissao_de?: string;
  emissao_ate?: string;
  /** Dia da leitura (AAAA-MM-DD, no fuso do computador). */
  data_leitura?: string;
};

export const CHAVES_FILTRO: (keyof FiltrosLeituras)[] = [
  'nome_cessionario', 'doc_cessionario', 'nome_sacado', 'doc_sacado', 'nome_cedente', 'doc_cedente', 'numero_documento',
  'base', 'tipo_recebivel', 'aquisicao_de', 'aquisicao_ate', 'emissao_de', 'emissao_ate', 'data_leitura',
];

export type LeituraVisualizar = Leitura & { base_nome: string | null; pdf_nome: string | null };

export const COLUNAS_ORDENAVEIS = [
  'cessionario_nome', 'cessionario_documento', 'cedente_nome', 'cedente_documento', 'sacado_nome', 'sacado_documento', 'numero_documento',
  'quantidade_parcelas', 'numero_parcela', 'valor_nominal', 'data_aquisicao', 'data_emissao', 'data_vencimento', 'operacao_id', 'tipo_recebivel', 'lida_em',
] as const;
export type ColunaOrdenavel = (typeof COLUNAS_ORDENAVEIS)[number];

/** Cada letra base e as formas dela (maiúscula e acentuadas) que a busca aceita. */
const VARIANTES: Record<string, string> = {
  a: 'aAáàâãäÁÀÂÃÄ', e: 'eEéèêëÉÈÊË', i: 'iIíìîïÍÌÎÏ', o: 'oOóòôõöÓÒÔÕÖ', u: 'uUúùûüÚÙÛÜ', c: 'cCçÇ', n: 'nNñÑ',
};

/**
 * Padrão GLOB que acha o termo sem diferenciar maiúsculas nem acentos (o ILIKE + unaccent do
 * Postgres). Classes de caracteres em vez de uma função SQL do app (o Turso não aceita funções
 * registradas) ou de REPLACEs aninhados (estouram a pilha do parser).
 */
function padraoBusca(termo: string): string {
  let p = '';
  for (const ch of normalizar(termo)) {
    if (VARIANTES[ch]) p += `[${VARIANTES[ch]}]`;
    else if (/[a-z]/.test(ch)) p += `[${ch}${ch.toUpperCase()}]`;
    else if (ch === '*' || ch === '?' || ch === '[') p += `[${ch}]`;
    else p += ch;
  }
  return `*${p}*`;
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function montarFiltro(f: FiltrosLeituras): { onde: string; args: (string | number)[] } {
  const onde: string[] = [];
  const args: (string | number)[] = [];
  const texto = (coluna: string, valor?: string) => {
    const v = valor?.trim();
    if (!v) return;
    onde.push(`${coluna} GLOB ?`);
    args.push(padraoBusca(v));
  };
  const documento = (coluna: string, valor?: string) => {
    const v = valor?.trim();
    if (!v) return;
    const digitos = v.replace(/\D/g, '');
    if (digitos.length >= 3 && digitos.length === v.replace(/[.\-/\s]/g, '').length) {
      onde.push(`REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${coluna}, ''), '.', ''), '-', ''), '/', ''), ' ', '') LIKE ?`);
      args.push(`%${digitos}%`);
    } else texto(coluna, v);
  };
  texto('l.cessionario_nome', f.nome_cessionario);
  documento('l.cessionario_documento', f.doc_cessionario);
  texto('l.sacado_nome', f.nome_sacado);
  documento('l.sacado_documento', f.doc_sacado);
  texto('l.cedente_nome', f.nome_cedente);
  documento('l.cedente_documento', f.doc_cedente);
  texto('l.numero_documento', f.numero_documento);
  texto('l.tipo_recebivel', f.tipo_recebivel);
  if (f.base?.trim()) {
    const v = padraoBusca(f.base.trim());
    onde.push('(l.base_id GLOB ? OR b.nome GLOB ? OR b.nome_fundo GLOB ?)');
    args.push(v, v, v);
  }
  const intervalo = (coluna: string, de?: string, ate?: string) => {
    if (de && DATA.test(de)) { onde.push(`${coluna} >= ?`); args.push(de); }
    if (ate && DATA.test(ate)) { onde.push(`${coluna} <= ?`); args.push(ate); }
  };
  intervalo('l.data_aquisicao', f.aquisicao_de, f.aquisicao_ate);
  intervalo('l.data_emissao', f.emissao_de, f.emissao_ate);
  if (f.data_leitura && DATA.test(f.data_leitura)) {
    const inicio = new Date(`${f.data_leitura}T00:00:00`);
    const fim = new Date(inicio.getTime());
    fim.setDate(fim.getDate() + 1);
    onde.push('l.lida_em >= ? AND l.lida_em < ?');
    args.push(inicio.toISOString(), fim.toISOString());
  }
  return { onde: onde.length ? `WHERE ${onde.join(' AND ')}` : '', args };
}

function ordem(coluna?: string, direcao?: string): string {
  const col = (COLUNAS_ORDENAVEIS as readonly string[]).includes(coluna ?? '') ? coluna! : 'lida_em';
  const dir = direcao === 'asc' ? 'ASC' : 'DESC';
  const expr = col === 'valor_nominal' ? 'CAST(l.valor_nominal AS REAL)' : `l.${col}`;
  return `ORDER BY ${expr} IS NULL, ${expr} ${dir}, l.id DESC`;
}

const FROM = 'FROM leituras l LEFT JOIN bases b ON b.id = l.base_id LEFT JOIN pdfs p ON p.id = l.pdf_id';

export async function buscarLeituras(f: FiltrosLeituras, opcoes: { pagina?: number; porPagina?: number; ordenarPor?: string; direcao?: string } = {}):
  Promise<{ linhas: LeituraVisualizar[]; total: number; pagina: number; paginas: number; por_pagina: number }> {
  const c = await db();
  const porPagina = Math.min(100, Math.max(1, opcoes.porPagina ?? 15));
  const { onde, args } = montarFiltro(f);
  const total = Number((await c.prepare(`SELECT COUNT(*) n ${FROM} ${onde}`).get<{ n: number }>(...args))?.n ?? 0);
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(Math.max(1, opcoes.pagina ?? 1), paginas);
  const linhas = await c.prepare(`SELECT l.*, b.nome AS base_nome, p.nome_arquivo AS pdf_nome ${FROM} ${onde} ${ordem(opcoes.ordenarPor, opcoes.direcao)}
    LIMIT ? OFFSET ?`).all<LeituraVisualizar>(...args, porPagina, (pagina - 1) * porPagina);
  return { linhas, total, pagina, paginas, por_pagina: porPagina };
}

/** Limite de linhas de uma planilha .xlsx (2^20 menos o cabeçalho). */
export const MAX_LINHAS_EXCEL = 1_048_575;

export async function todasAsLeituras(f: FiltrosLeituras, opcoes: { ordenarPor?: string; direcao?: string } = {}): Promise<LeituraVisualizar[]> {
  const c = await db();
  const { onde, args } = montarFiltro(f);
  return c.prepare(`SELECT l.*, b.nome AS base_nome, p.nome_arquivo AS pdf_nome ${FROM} ${onde} ${ordem(opcoes.ordenarPor, opcoes.direcao)} LIMIT ?`)
    .all<LeituraVisualizar>(...args, MAX_LINHAS_EXCEL + 1);
}

export function filtrosDaUrl(params: URLSearchParams): FiltrosLeituras {
  const f: FiltrosLeituras = {};
  for (const k of CHAVES_FILTRO) {
    const v = params.get(k);
    if (v && v.trim()) f[k] = v.trim();
  }
  return f;
}

/** As 15 colunas do Bate Lastro (PlanilhaLogs.jsx allColumns). */
export const COLUNAS_VISUALIZAR: { chave: string; coluna: keyof Leitura; rotulo: string; tipo?: 'moeda' | 'data' | 'inteiro' }[] = [
  { chave: 'NOME_CESSIONARIO', coluna: 'cessionario_nome', rotulo: 'Nome Cessionário' },
  { chave: 'DOC_CESSIONARIO', coluna: 'cessionario_documento', rotulo: 'Doc Cessionário' },
  { chave: 'NOME_CEDENTE', coluna: 'cedente_nome', rotulo: 'Nome Cedente' },
  { chave: 'DOC_CEDENTE', coluna: 'cedente_documento', rotulo: 'Doc Cedente' },
  { chave: 'NOME_SACADO', coluna: 'sacado_nome', rotulo: 'Nome Sacado' },
  { chave: 'DOC_SACADO', coluna: 'sacado_documento', rotulo: 'Doc Sacado' },
  { chave: 'NU_DOCUMENTO', coluna: 'numero_documento', rotulo: 'Nº Documento' },
  { chave: 'QUANTIDADE_PARCELAS', coluna: 'quantidade_parcelas', rotulo: 'Qtd Parcelas', tipo: 'inteiro' },
  { chave: 'NUMERO_PARCELA', coluna: 'numero_parcela', rotulo: 'Nº Parcela', tipo: 'inteiro' },
  { chave: 'VALOR_NOMINAL', coluna: 'valor_nominal', rotulo: 'Valor Nominal', tipo: 'moeda' },
  { chave: 'DATA_AQUISICAO', coluna: 'data_aquisicao', rotulo: 'Data Aquisição', tipo: 'data' },
  { chave: 'DATA_EMISSAO', coluna: 'data_emissao', rotulo: 'Data Emissão', tipo: 'data' },
  { chave: 'DATA_VENCIMENTO_ORIGINAL', coluna: 'data_vencimento', rotulo: 'Data Vencimento', tipo: 'data' },
  { chave: 'OPERACAO_ID', coluna: 'operacao_id', rotulo: 'Operação ID' },
  { chave: 'TIPO_RECEBIVEL', coluna: 'tipo_recebivel', rotulo: 'Tipo Recebível' },
];

/** Planilha .xlsx das leituras filtradas (exceljs, no servidor). */
export async function planilhaDasLeituras(linhas: LeituraVisualizar[], colunasVisiveis?: string[]): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const livro = new ExcelJS.Workbook();
  const aba = livro.addWorksheet('Leituras');
  const colunas = COLUNAS_VISUALIZAR.filter((c) => !colunasVisiveis?.length || colunasVisiveis.includes(c.chave));
  aba.columns = [
    ...colunas.map((c) => ({ header: c.rotulo, key: c.chave, width: c.tipo === 'data' ? 14 : c.tipo === 'moeda' ? 16 : 24 })),
    { header: 'Base', key: 'BASE', width: 28 },
    { header: 'PDF', key: 'PDF', width: 30 },
    { header: 'Data Leitura', key: 'DATA_LEITURA', width: 20 },
  ];
  aba.getRow(1).font = { bold: true };
  const data = (iso: string | null) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  };
  for (const l of linhas) {
    const linha: Record<string, unknown> = {};
    for (const c of colunas) {
      const v = l[c.coluna];
      linha[c.chave] = c.tipo === 'moeda' ? (v === null ? null : Number(v)) : c.tipo === 'data' ? data(v as string | null) : v;
    }
    linha.BASE = l.base_nome ?? l.base_id;
    linha.PDF = l.pdf_nome;
    linha.DATA_LEITURA = l.lida_em ? new Date(l.lida_em) : null;
    aba.addRow(linha);
  }
  for (const c of colunas) {
    if (c.tipo === 'moeda') aba.getColumn(c.chave).numFmt = '#,##0.00';
    if (c.tipo === 'data') aba.getColumn(c.chave).numFmt = 'dd/mm/yyyy';
  }
  aba.getColumn('DATA_LEITURA').numFmt = 'dd/mm/yyyy hh:mm';
  aba.views = [{ state: 'frozen', ySplit: 1 }];
  return new Uint8Array(await livro.xlsx.writeBuffer());
}
