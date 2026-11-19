import type { Esquema } from './tipos';

/**
 * Leituras e pré-bates (registroLeitura / pre_match do Bate Lastro).
 *
 * - leituras: os campos lidos de um documento (pela IA no Anexo, pelo Bater PDF ou vindos da
 *   planilha do Inserir Resultado). tipo_recebivel começando com 'termo_cessao' = lado Termo;
 *   qualquer outro (ou vazio) = lado Lastro.
 * - pre_matches: o "Processar Base" sugere uma leitura para uma pendência (título × lado).
 *   Confirmar vira vínculo (o match); rejeitar apaga a sugestão.
 * - uso_ia: tokens e custo de cada chamada ao Gemini (registroUsoAI).
 */
export const LEITURAS: Esquema = {
  nome: 'leituras',
  sql: `
CREATE TABLE IF NOT EXISTS leituras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  pdf_id INTEGER REFERENCES pdfs(id) ON DELETE SET NULL,
  documento_id INTEGER REFERENCES anexo_documentos(id) ON DELETE SET NULL,
  operacao_id TEXT,
  tipo_documento TEXT,                       -- classificação do documento (ccb, duplicata, termo_cessao…)
  tipo_recebivel TEXT,                       -- TIPO_RECEBIVEL: 'termo_cessao…' = Termo; resto = Lastro
  numero_documento TEXT,
  sacado_nome TEXT,
  sacado_documento TEXT,
  cedente_nome TEXT,
  cedente_documento TEXT,
  cessionario_nome TEXT,
  cessionario_documento TEXT,
  valor_nominal TEXT,                        -- '1234.56'
  data_aquisicao TEXT,                       -- ISO yyyy-mm-dd
  data_emissao TEXT,
  data_vencimento TEXT,
  numero_parcela INTEGER,
  quantidade_parcelas INTEGER,
  ente_consignante TEXT,
  origem TEXT NOT NULL,                      -- 'ia' | 'bater_pdf' | 'planilha' | 'manual'
  dados TEXT,                                -- JSON bruto devolvido pela IA (auditoria)
  lida_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leituras_base ON leituras(base_id);
CREATE INDEX IF NOT EXISTS idx_leituras_pdf ON leituras(pdf_id);

CREATE TABLE IF NOT EXISTS pre_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  pendencia_id INTEGER NOT NULL UNIQUE REFERENCES pendencias(id) ON DELETE CASCADE,
  leitura_id INTEGER NOT NULL REFERENCES leituras(id) ON DELETE CASCADE,
  similaridade REAL NOT NULL,
  criterio INTEGER,                          -- índice do critério da cascata que achou o par
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pre_matches_base ON pre_matches(base_id);
CREATE INDEX IF NOT EXISTS idx_pre_matches_leitura ON pre_matches(leitura_id);

CREATE TABLE IF NOT EXISTS uso_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_id TEXT,
  documento_id INTEGER,
  etapa TEXT NOT NULL,                       -- 'classificacao' | 'leitura' | 'teste_tipo'
  modelo TEXT NOT NULL,
  tokens_entrada INTEGER,
  tokens_saida INTEGER,
  custo_usd REAL,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uso_ia_documento ON uso_ia(documento_id);
CREATE INDEX IF NOT EXISTS idx_leituras_documento ON leituras(documento_id);
`,
  colunas: [
    // Resultado da chamada (Sucesso ou o erro), como o log_msg do registroUsoAI.
    { tabela: 'uso_ia', coluna: 'mensagem', definicao: 'TEXT' },
  ],
};
