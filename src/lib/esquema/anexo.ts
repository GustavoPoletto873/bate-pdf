import type { Esquema } from './tipos';

/**
 * Gestão › Anexo e Análise › Lotes (anexo_upload_batch / anexo_operacao / anexo_upload_documento
 * e a tabela jobs do Bate Lastro).
 *
 * Um lote é um envio de documentos para uma base. Com "agrupamento por operação" ligado, a pasta
 * que contém o arquivo é a operação; desligado, cada arquivo é uma operação. Cada documento vira
 * um job de leitura (fila local, no lugar do SQS + worker do Bate Lastro).
 */
export const ANEXO: Esquema = {
  nome: 'anexo',
  sql: `
CREATE TABLE IF NOT EXISTS anexo_lotes (
  id TEXT PRIMARY KEY,                       -- uuid
  base_id TEXT REFERENCES bases(id) ON DELETE CASCADE,
  fundo_id INTEGER REFERENCES fundos(id) ON DELETE SET NULL,
  agrupar_por_pasta INTEGER NOT NULL DEFAULT 0,
  total_documentos INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anexo_operacoes (
  id TEXT PRIMARY KEY,                       -- uuid (vale só dentro do lote)
  lote_id TEXT NOT NULL REFERENCES anexo_lotes(id) ON DELETE CASCADE,
  chave TEXT NOT NULL                        -- caminho da pasta (sem diferenciar maiúsculas)
);

CREATE TABLE IF NOT EXISTS anexo_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote_id TEXT NOT NULL REFERENCES anexo_lotes(id) ON DELETE CASCADE,
  operacao_id TEXT REFERENCES anexo_operacoes(id) ON DELETE SET NULL,
  pdf_id INTEGER REFERENCES pdfs(id) ON DELETE SET NULL,
  caminho TEXT NOT NULL,                     -- caminho relativo como veio da pasta/ZIP
  nome_arquivo TEXT NOT NULL,
  extensao TEXT,
  -- recebido | enfileirado | classificando | extraindo | lido | somente_classificado | erro
  status TEXT NOT NULL DEFAULT 'recebido',
  tipo_documento TEXT,
  motivo TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anexo_documentos_lote ON anexo_documentos(lote_id);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                        -- 'leitura_lastro'
  base_id TEXT REFERENCES bases(id) ON DELETE CASCADE,
  documento_id INTEGER REFERENCES anexo_documentos(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | processing | done | failed
  tentativas INTEGER NOT NULL DEFAULT 0,
  erro TEXT,
  resultado TEXT,                            -- JSON
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_base ON jobs(base_id);
CREATE INDEX IF NOT EXISTS idx_jobs_documento ON jobs(documento_id);
CREATE INDEX IF NOT EXISTS idx_anexo_documentos_status ON anexo_documentos(status);
CREATE INDEX IF NOT EXISTS idx_anexo_operacoes_lote ON anexo_operacoes(lote_id, chave);
`,
  colunas: [
    // Nome e caminho da pasta da operação (null sem agrupamento: cada arquivo é uma operação).
    { tabela: 'anexo_operacoes', coluna: 'nome', definicao: 'TEXT' },
    { tabela: 'anexo_operacoes', coluna: 'caminho', definicao: 'TEXT' },
    // De onde veio o documento (ex.: lote.zip!/OP1/ccb.pdf), tamanho e páginas.
    { tabela: 'anexo_documentos', coluna: 'origem', definicao: 'TEXT' },
    { tabela: 'anexo_documentos', coluna: 'tamanho', definicao: 'INTEGER' },
    { tabela: 'anexo_documentos', coluna: 'paginas', definicao: 'INTEGER' },
    // XML guardado na pasta de dados (relativo a ela); PDFs ficam em pdfs/<base>.
    { tabela: 'anexo_documentos', coluna: 'arquivo', definicao: 'TEXT' },
    { tabela: 'anexo_lotes', coluna: 'total_bytes', definicao: 'INTEGER NOT NULL DEFAULT 0' },
  ],
};
