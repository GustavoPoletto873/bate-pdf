/**
 * Colunas de destino do Upload Base (COLUNAS_PADRAO em backend/modules/base_direito_creditorio.py)
 * e as regras de validação que dependem delas. Sem dependências: a tela usa os mesmos nomes.
 */

export const COLUNAS_UPLOAD = [
  'NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO', 'DOC_SACADO', 'NU_DOCUMENTO', 'TIPO_RECEBIVEL',
  'DATA_AQUISICAO', 'DATA_EMISSAO', 'DATA_VENCIMENTO_ORIGINAL', 'VALOR_NOMINAL', 'VALOR_AQUISICAO', 'CHAVE_NFE',
] as const;

export type ColunaUpload = (typeof COLUNAS_UPLOAD)[number];

/** validar_dados_direito_creditorio: não podem vir vazios. */
export const COLUNAS_OBRIGATORIAS: ColunaUpload[] = ['NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO', 'DOC_SACADO', 'NU_DOCUMENTO'];
export const COLUNAS_DATA: ColunaUpload[] = ['DATA_AQUISICAO', 'DATA_EMISSAO', 'DATA_VENCIMENTO_ORIGINAL'];
export const COLUNAS_VALOR: ColunaUpload[] = ['VALOR_NOMINAL', 'VALOR_AQUISICAO'];

export const CAMPO_VENCIMENTO: ColunaUpload = 'DATA_VENCIMENTO_ORIGINAL';

/** O que vai em cada coluna de destino (dica da tela de mapeamento). */
export const DESCRICAO_COLUNA: Record<ColunaUpload, string> = {
  NOME_CEDENTE: 'Nome de quem cedeu o crédito ao fundo',
  DOC_CEDENTE: 'CPF ou CNPJ do cedente',
  NOME_SACADO: 'Nome do devedor (sacado)',
  DOC_SACADO: 'CPF ou CNPJ do sacado',
  NU_DOCUMENTO: 'Número do documento (duplicata, CCB, contrato…)',
  TIPO_RECEBIVEL: 'Tipo do recebível (CCB, Duplicata…)',
  DATA_AQUISICAO: 'Data em que o fundo adquiriu o crédito',
  DATA_EMISSAO: 'Data de emissão do documento',
  DATA_VENCIMENTO_ORIGINAL: 'Data de vencimento do documento',
  VALOR_NOMINAL: 'Valor do documento em reais',
  VALOR_AQUISICAO: 'Valor pago pelo fundo na aquisição',
  CHAVE_NFE: 'Chave da nota fiscal eletrônica (44 dígitos), se houver',
};

/** Resultado de "Analisar Arquivo" (analisar_arquivo). */
export type AnaliseArquivo = {
  colunas_arquivo: string[];
  colunas_padrao: string[];
  total_linhas: number;
  sugestoes_mapeamento: Record<string, string>;
  colunas_ja_padrao: string[];
  precisa_mapeamento: boolean;
  cobertura_automatica: number;
  /** Colunas de vencimento (original/ajustada): numa linha em que a escolhida estiver vazia, vale a outra. */
  colunas_vencimento: string[];
  /** Aba lida (a com mais colunas reconhecidas; empate = a primeira). */
  aba: string;
  /** Primeiras linhas, para conferir o mapeamento. */
  exemplo: Record<string, string>[];
};
