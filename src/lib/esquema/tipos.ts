/** Uma coluna acrescentada depois que a tabela já existia (bancos criados por versões antigas). */
export type ColunaNova = { tabela: string; coluna: string; definicao: string };

/**
 * Esquema de um módulo: o SQL idempotente (IF NOT EXISTS), as colunas que ele acrescenta e os
 * índices que dependem delas (criados depois das colunas, para bancos antigos).
 */
export type Esquema = { nome: string; sql: string; colunas?: ColunaNova[]; indices?: string[] };
