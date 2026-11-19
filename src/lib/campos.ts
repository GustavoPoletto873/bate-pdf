/**
 * Os 11 campos conferidos no Bater PDF — mesma lista, rótulos e regras de
 * divergencia.js (frontend do Bate Lastro) e das colunas DIV_* do
 * resultados_matching_*.xlsx (export_excel.py / importar_resultado_matching_service.py).
 *
 * Módulo puro: usado no servidor e no navegador.
 */

export type Lado = 'termo' | 'lastro';
export type Veredito = 'V' | 'D' | 'P';
export type TipoCampo = 'documento' | 'texto' | 'moeda' | 'data' | 'pessoa';

export type CampoId =
  | 'numero_documento'
  | 'sacado_nome'
  | 'sacado_documento'
  | 'cedente_nome'
  | 'cedente_documento'
  | 'valor_total'
  | 'data_emissao'
  | 'data_vencimento'
  | 'data_aquisicao'
  | 'nome_cessionario'
  | 'doc_cessionario';

export type DefCampo = {
  campo: CampoId;
  rotulo: string;
  curto: string;
  tipo: TipoCampo;
  /** Coluna do título (amostra) comparada com este campo. */
  campoBase: keyof TituloAmostra;
  /** Coluna DIV_* e LEITURA_* do resultados_matching. */
  colunaDiv: string;
  colunaLeitura: string;
  soTermo?: boolean;
};

export type TituloAmostra = {
  numero_documento: string | null;
  sacado_nome: string | null;
  sacado_documento: string | null;
  cedente_nome: string | null;
  cedente_documento: string | null;
  valor_total: string | null;
  valor_aquisicao: string | null;
  data_emissao: string | null;
  data_vencimento: string | null;
  data_aquisicao: string | null;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  tipo_recebivel: string | null;
  chave_nfe: string | null;
};

export const CAMPOS: DefCampo[] = [
  { campo: 'numero_documento', rotulo: 'Nº Documento', curto: 'Nº', tipo: 'documento', campoBase: 'numero_documento', colunaDiv: 'DIV_NUMERO_DOC', colunaLeitura: 'LEITURA_NUMERO_DOC' },
  { campo: 'sacado_nome', rotulo: 'Sacado', curto: 'Sacado', tipo: 'texto', campoBase: 'sacado_nome', colunaDiv: 'DIV_NOME_SACADO', colunaLeitura: 'LEITURA_NOME_SACADO' },
  { campo: 'sacado_documento', rotulo: 'Doc. Sacado', curto: 'Doc. Sac.', tipo: 'pessoa', campoBase: 'sacado_documento', colunaDiv: 'DIV_DOC_SACADO', colunaLeitura: 'LEITURA_DOC_SACADO' },
  { campo: 'cedente_nome', rotulo: 'Cedente', curto: 'Cedente', tipo: 'texto', campoBase: 'cedente_nome', colunaDiv: 'DIV_NOME_CEDENTE', colunaLeitura: 'LEITURA_NOME_CEDENTE' },
  { campo: 'cedente_documento', rotulo: 'Doc. Cedente', curto: 'Doc. Ced.', tipo: 'pessoa', campoBase: 'cedente_documento', colunaDiv: 'DIV_DOC_CEDENTE', colunaLeitura: 'LEITURA_DOC_CEDENTE' },
  { campo: 'valor_total', rotulo: 'Valor', curto: 'Valor', tipo: 'moeda', campoBase: 'valor_total', colunaDiv: 'DIV_VALOR_NOMINAL', colunaLeitura: 'LEITURA_VALOR_NOMINAL' },
  { campo: 'data_emissao', rotulo: 'Emissão', curto: 'Emissão', tipo: 'data', campoBase: 'data_emissao', colunaDiv: 'DIV_DATA_EMISSAO', colunaLeitura: 'LEITURA_DATA_EMISSAO' },
  { campo: 'data_vencimento', rotulo: 'Vencimento', curto: 'Venc.', tipo: 'data', campoBase: 'data_vencimento', colunaDiv: 'DIV_DATA_VENCIMENTO', colunaLeitura: 'LEITURA_DATA_VENCIMENTO' },
  { campo: 'data_aquisicao', rotulo: 'Data Aquisição', curto: 'Aquis.', tipo: 'data', campoBase: 'data_aquisicao', colunaDiv: 'DIV_DATA_AQUISICAO', colunaLeitura: 'LEITURA_DATA_AQUISICAO', soTermo: true },
  { campo: 'nome_cessionario', rotulo: 'Nome Cessionário', curto: 'Cession.', tipo: 'texto', campoBase: 'nome_fundo', colunaDiv: 'DIV_NOME_CESSIONARIO', colunaLeitura: 'LEITURA_NOME_CESSIONARIO', soTermo: true },
  { campo: 'doc_cessionario', rotulo: 'Doc. Cessionário', curto: 'Doc. Cess.', tipo: 'documento', campoBase: 'cnpj_fundo', colunaDiv: 'DIV_DOC_CESSIONARIO', colunaLeitura: 'LEITURA_DOC_CESSIONARIO', soTermo: true },
];

export const CAMPO_POR_ID: Record<CampoId, DefCampo> = Object.fromEntries(
  CAMPOS.map((c) => [c.campo, c]),
) as Record<CampoId, DefCampo>;

/** Termo confere os 11; Lastro só os 8 comuns (mesma regra do Excel). */
export function camposDoLado(lado: Lado): DefCampo[] {
  return lado === 'termo' ? CAMPOS : CAMPOS.filter((c) => !c.soTermo);
}

export const VEREDITOS: Record<Veredito, { titulo: string; classe: string }> = {
  V: { titulo: 'Confere', classe: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/40' },
  D: { titulo: 'Divergente', classe: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40' },
  P: { titulo: 'Sem valor / não decidido', classe: 'bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-500/20 dark:text-pink-200 dark:border-pink-500/40' },
};

/** Ciclo do clique na célula: P → V → D → P (igual ao Bater PDF). */
export function proximoVeredito(atual: Veredito | undefined): Veredito {
  if (atual === 'V') return 'D';
  if (atual === 'D') return 'P';
  return 'V';
}

/**
 * Chave de comparação do nº do documento: letras contam ('A030-81962'),
 * pontuação e o "'" do Excel não (comparar_documento / chaveDocumento).
 */
export function chaveDocumento(valor: unknown): string {
  return String(valor ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** O nº como impresso, sem o prefixo "'" do Excel — também é o termo de busca. */
export function documentoParaBusca(valor: unknown): string {
  return String(valor ?? '').trim().replace(/^'/, '').trim();
}

/** Valor do título (amostra) para o campo. */
export function valorDaAmostra(titulo: Partial<TituloAmostra>, campo: CampoId): string | null {
  const v = titulo[CAMPO_POR_ID[campo].campoBase];
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' || t === '-' ? null : t;
}

/**
 * O que vai na coluna LEITURA_* da exportação e no vínculo: V → o valor da
 * amostra (é o que o Bate Lastro grava ao marcar V); D → o que o documento traz
 * ('' = o documento não traz o campo); P → vazio.
 */
export function valorDaLeitura(
  titulo: Partial<TituloAmostra>,
  campo: CampoId,
  veredito: Veredito,
  valorDigitado: string | null | undefined,
): string | null {
  if (veredito === 'V') return valorDaAmostra(titulo, campo);
  if (veredito === 'D') return valorDigitado ? valorDigitado : null;
  return null;
}

/** Ainda há campo em P? (P bloqueia o vínculo: "não decidi", ver divergencia.js). */
export function camposEmP(lado: Lado, marcacoes: Partial<Record<CampoId, Veredito>>): DefCampo[] {
  return camposDoLado(lado).filter((c) => marcacoes[c.campo] !== 'V' && marcacoes[c.campo] !== 'D');
}

/** Rótulo do lado. */
export const ROTULO_LADO: Record<Lado, string> = { termo: 'Termo', lastro: 'Lastro' };
