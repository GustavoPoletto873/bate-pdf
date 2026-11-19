import type { DatabaseSync } from 'node:sqlite';
import { camposDoLado, type CampoId, type Lado } from '@/lib/campos';
import type { LeituraCampos } from '@/lib/bates/comparacao';

/** Linha da tabela `leituras` (registroLeitura do Bate Lastro). */
export type LeituraLinha = {
  id: number;
  base_id: string;
  pdf_id: number | null;
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
  origem: string;
  lida_em: string;
};

export const COLUNAS_LEITURA = `l.id, l.base_id, l.pdf_id, l.tipo_recebivel, l.numero_documento, l.sacado_nome, l.sacado_documento,
  l.cedente_nome, l.cedente_documento, l.cessionario_nome, l.cessionario_documento, l.valor_nominal, l.data_aquisicao,
  l.data_emissao, l.data_vencimento, l.origem, l.lida_em`;

/** Campo conferido → coluna da tabela leituras. */
export const COLUNA_DA_LEITURA: Record<CampoId, keyof LeituraLinha> = {
  numero_documento: 'numero_documento',
  sacado_nome: 'sacado_nome',
  sacado_documento: 'sacado_documento',
  cedente_nome: 'cedente_nome',
  cedente_documento: 'cedente_documento',
  valor_total: 'valor_nominal',
  data_emissao: 'data_emissao',
  data_vencimento: 'data_vencimento',
  data_aquisicao: 'data_aquisicao',
  nome_cessionario: 'cessionario_nome',
  doc_cessionario: 'cessionario_documento',
};

const vazioParaNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

/** Os campos da leitura com as chaves dos campos conferidos (só os do lado, se informado). */
export function camposDaLeitura(l: Partial<LeituraLinha>, lado?: Lado): LeituraCampos {
  const r: LeituraCampos = {};
  const campos = lado ? camposDoLado(lado).map((c) => c.campo) : (Object.keys(COLUNA_DA_LEITURA) as CampoId[]);
  for (const campo of campos) r[campo] = vazioParaNull(l[COLUNA_DA_LEITURA[campo]]);
  return r;
}

/**
 * Grava uma leitura feita aqui (origem 'bater_pdf' ou 'planilha') a partir dos campos conferidos.
 * Chamar dentro de uma transação. Devolve o id.
 */
export function inserirLeitura(conexao: DatabaseSync, dados: {
  base_id: string;
  pdf_id: number | null;
  tipo_recebivel: string;
  origem: string;
  campos: LeituraCampos;
  lida_em: string;
}): number {
  const colunas = (Object.keys(COLUNA_DA_LEITURA) as CampoId[]).filter((c) => dados.campos[c] !== undefined);
  const nomes = colunas.map((c) => COLUNA_DA_LEITURA[c]);
  const r = conexao.prepare(`INSERT INTO leituras (base_id, pdf_id, tipo_recebivel, origem, lida_em${nomes.map((n) => `, ${n}`).join('')})
    VALUES (?, ?, ?, ?, ?${', ?'.repeat(nomes.length)})`)
    .run(dados.base_id, dados.pdf_id, dados.tipo_recebivel, dados.origem, dados.lida_em, ...colunas.map((c) => vazioParaNull(dados.campos[c])));
  return Number(r.lastInsertRowid);
}

/** TIPO_RECEBIVEL de uma leitura criada aqui (Bater PDF, planilha): Termo = 'termo_cessao'. */
export function tipoRecebivelDoLado(lado: Lado, tipoDoTitulo: string | null | undefined): string {
  if (lado === 'termo') return 'termo_cessao';
  const t = String(tipoDoTitulo ?? '').trim();
  return t && !t.toLowerCase().startsWith('termo_cessao') ? t : 'lastro';
}
