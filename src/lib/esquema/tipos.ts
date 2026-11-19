/** Uma coluna acrescentada depois que a tabela já existia (bancos criados por versões antigas). */
export type ColunaNova = { tabela: string; coluna: string; definicao: string };

/** Esquema de um módulo: o SQL idempotente (IF NOT EXISTS) e as colunas que ele acrescenta. */
export type Esquema = { nome: string; sql: string; colunas?: ColunaNova[] };
