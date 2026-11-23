import { db, inserirVarios, reservarIds, transacao, type Banco, excluir } from '@/lib/db';
import { lerData, lerMoeda } from '@/lib/valores';

/**
 * Leituras de documentos (registroLeitura do Bate Lastro): uma linha por título/parcela lida.
 * Escritas pelo Anexo (IA e XML de NF-e) e, por outros módulos, pelo Bater PDF ou pela
 * planilha. Lidas pela Gestão de Bates (pré-bates) e pela tela Visualizar.
 *
 * Semântica das colunas: valor_nominal '1234.56' (lerMoeda); datas ISO 'AAAA-MM-DD' (lerData);
 * tipo_recebivel começando com 'termo_cessao' = lado Termo; qualquer outro = Lastro.
 */

export type Leitura = {
  id: number;
  base_id: string;
  pdf_id: number | null;
  documento_id: number | null;
  operacao_id: string | null;
  tipo_documento: string | null;
  tipo_recebivel: string | null;
  numero_documento: string | null;
  sacado_nome: string | null;
  sacado_documento: string | null;
  cedente_nome: string | null;
  cedente_documento: string | null;
  cessionario_nome: string | null;
  cessionario_documento: string | null;
  valor_nominal: string | null;
  data_aquisicao: string | null;
  data_emissao: string | null;
  data_vencimento: string | null;
  numero_parcela: number | null;
  quantidade_parcelas: number | null;
  ente_consignante: string | null;
  origem: string;
  /** JSON bruto da leitura (auditoria). */
  dados: string | null;
  lida_em: string;
};

/** O que se grava: tudo opcional menos a origem ('ia' | 'bater_pdf' | 'planilha' | 'manual'). */
export type NovaLeitura = Partial<Omit<Leitura, 'id' | 'base_id' | 'lida_em' | 'dados' | 'valor_nominal'>> & {
  origem: string;
  /** Aceita número, '1.234,56' ou '1234.56'; grava '1234.56'. */
  valor_nominal?: string | number | null;
  /** Objeto vira JSON. */
  dados?: unknown;
  lida_em?: string;
};

const COLUNAS = [
  'pdf_id', 'documento_id', 'operacao_id', 'tipo_documento', 'tipo_recebivel', 'numero_documento',
  'sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento', 'cessionario_nome', 'cessionario_documento',
  'valor_nominal', 'data_aquisicao', 'data_emissao', 'data_vencimento', 'numero_parcela', 'quantidade_parcelas',
  'ente_consignante', 'origem', 'dados', 'lida_em',
] as const;

const textoOuNulo = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
};

const inteiroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/** Normaliza uma linha para gravar (moeda, datas, textos vazios). */
export function normalizarLeitura(l: NovaLeitura): Record<(typeof COLUNAS)[number], string | number | null> {
  return {
    pdf_id: l.pdf_id ?? null,
    documento_id: l.documento_id ?? null,
    operacao_id: textoOuNulo(l.operacao_id),
    tipo_documento: textoOuNulo(l.tipo_documento),
    tipo_recebivel: textoOuNulo(l.tipo_recebivel),
    numero_documento: textoOuNulo(l.numero_documento),
    sacado_nome: textoOuNulo(l.sacado_nome),
    sacado_documento: textoOuNulo(l.sacado_documento),
    cedente_nome: textoOuNulo(l.cedente_nome),
    cedente_documento: textoOuNulo(l.cedente_documento),
    cessionario_nome: textoOuNulo(l.cessionario_nome),
    cessionario_documento: textoOuNulo(l.cessionario_documento),
    valor_nominal: lerMoeda(l.valor_nominal),
    data_aquisicao: lerData(l.data_aquisicao),
    data_emissao: lerData(l.data_emissao),
    data_vencimento: lerData(l.data_vencimento),
    numero_parcela: inteiroOuNulo(l.numero_parcela),
    quantidade_parcelas: inteiroOuNulo(l.quantidade_parcelas),
    ente_consignante: textoOuNulo(l.ente_consignante),
    origem: l.origem,
    dados: l.dados === undefined || l.dados === null ? null : typeof l.dados === 'string' ? l.dados : JSON.stringify(l.dados),
    lida_em: l.lida_em ?? new Date().toISOString(),
  };
}

async function inserirNa(tx: Banco, baseId: string, linhas: NovaLeitura[]): Promise<number[]> {
  // Ids reservados: todas as linhas num lote só (no Turso, uma ida por linha seria lenta).
  const primeiro = await reservarIds(tx, 'leituras', linhas.length);
  const ids = linhas.map((_, k) => primeiro + k);
  await inserirVarios(tx, 'leituras', ['id', 'base_id', ...COLUNAS], linhas.map((l, k) => {
    const n = normalizarLeitura(l);
    return [ids[k], baseId, ...COLUNAS.map((c) => n[c])];
  }));
  return ids;
}

/**
 * Grava as leituras na base e devolve os ids criados. Com `tx`, grava dentro dessa transação;
 * senão abre uma.
 */
export async function inserirLeituras(baseId: string, linhas: NovaLeitura[], opcoes: { tx?: Banco } = {}): Promise<number[]> {
  if (!linhas.length) return [];
  return opcoes.tx ? inserirNa(opcoes.tx, baseId, linhas) : transacao((tx) => inserirNa(tx, baseId, linhas));
}

export type FiltroLeituras = {
  documentoId?: number;
  pdfId?: number;
  operacaoId?: string;
  origem?: string;
  /** 'termo' = tipo_recebivel começa com 'termo_cessao'; 'lastro' = o resto. */
  lado?: 'termo' | 'lastro';
};

/** Leituras de uma base (ordem de gravação). */
export async function listarLeituras(baseId: string, filtros: FiltroLeituras = {}): Promise<Leitura[]> {
  const onde = ['base_id = ?'];
  const args: (string | number)[] = [baseId];
  if (filtros.documentoId !== undefined) { onde.push('documento_id = ?'); args.push(filtros.documentoId); }
  if (filtros.pdfId !== undefined) { onde.push('pdf_id = ?'); args.push(filtros.pdfId); }
  if (filtros.operacaoId !== undefined) { onde.push('operacao_id = ?'); args.push(filtros.operacaoId); }
  if (filtros.origem !== undefined) { onde.push('origem = ?'); args.push(filtros.origem); }
  if (filtros.lado === 'termo') onde.push("COALESCE(tipo_recebivel, '') LIKE 'termo_cessao%'");
  if (filtros.lado === 'lastro') onde.push("COALESCE(tipo_recebivel, '') NOT LIKE 'termo_cessao%'");
  return (await db()).prepare(`SELECT * FROM leituras WHERE ${onde.join(' AND ')} ORDER BY id`).all<Leitura>(...args);
}

export async function obterLeitura(id: number): Promise<Leitura | null> {
  return (await (await db()).prepare('SELECT * FROM leituras WHERE id = ?').get<Leitura>(id)) ?? null;
}

/** Lado da leitura, como no Bate Lastro: TIPO_RECEBIVEL 'termo_cessao…' = Termo. */
export function ladoDaLeitura(l: Pick<Leitura, 'tipo_recebivel'>): 'termo' | 'lastro' {
  return (l.tipo_recebivel ?? '').startsWith('termo_cessao') ? 'termo' : 'lastro';
}

/** Apaga as leituras de um documento (antes de gravar a nova leitura dele). Com `tx`, dentro dela. */
export async function apagarLeiturasDoDocumento(documentoId: number, tx?: Banco): Promise<void> {
  await excluir(tx ?? (await db()), 'leituras', 'documento_id = ?', [documentoId]);
}
