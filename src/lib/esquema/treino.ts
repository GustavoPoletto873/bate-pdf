import type { Esquema } from './tipos';

/**
 * Gestão › Treinar IA (tipo_documento_personalizado e documento_treinamento_ia do Bate Lastro).
 * Tipos treinados entram na classificação e na leitura do Anexo. O PDF de exemplo fica em
 * <dados>/treino/. `treino_documentos` guarda só a decisão de alguém sobre um documento que a
 * IA não leu (separado para treinar, ignorado, treinado).
 */
export const TREINO: Esquema = {
  nome: 'treino',
  sql: `
CREATE TABLE IF NOT EXISTS tipos_documento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  nome_exibicao TEXT NOT NULL,
  descricao_identificacao TEXT NOT NULL,
  instrucoes_gerais TEXT,
  campos TEXT NOT NULL,                      -- JSON: coluna → { presente, obrigatorio, instrucao, repete_por_linha }
  multi_recebiveis INTEGER NOT NULL DEFAULT 0,
  instrucao_parcelas TEXT,
  amostra TEXT,                              -- caminho do PDF de exemplo, relativo à pasta de dados
  ativo INTEGER NOT NULL DEFAULT 1,
  versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  excluido_em TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tipos_documento_slug ON tipos_documento(slug) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS treino_documentos (
  documento_id INTEGER PRIMARY KEY REFERENCES anexo_documentos(id) ON DELETE CASCADE,
  situacao TEXT NOT NULL,                    -- 'separado' | 'ignorado' | 'treinado'
  grupo TEXT,
  tipo_documento_id INTEGER REFERENCES tipos_documento(id) ON DELETE SET NULL,
  decidido_em TEXT NOT NULL
);
`,
};
