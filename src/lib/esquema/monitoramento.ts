import type { Esquema } from './tipos';

/**
 * Gestão › BlackList e Gestão › Amostra (blacklist_* e amostragens do Bate Lastro).
 *
 * A BlackList não bloqueia nada: só monitora cedentes/sacados e avisa quando aparecem numa base.
 * A amostragem é determinística (seed): os arquivos gerados ficam em <dados>/amostragens/<id>/.
 */
export const MONITORAMENTO: Esquema = {
  nome: 'monitoramento',
  sql: `
CREATE TABLE IF NOT EXISTS blacklist_entradas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  documento TEXT NOT NULL,                   -- só dígitos, 11 ou 14 com zeros à esquerda
  tipo_documento TEXT NOT NULL,              -- 'CPF' | 'CNPJ'
  criado_em TEXT NOT NULL,
  excluido_em TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklist_doc_ativo ON blacklist_entradas(documento) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS blacklist_ocorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entrada_id INTEGER NOT NULL REFERENCES blacklist_entradas(id) ON DELETE CASCADE,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  titulo_id INTEGER NOT NULL REFERENCES titulos(id) ON DELETE CASCADE,
  papel TEXT NOT NULL,                       -- 'cedente' | 'sacado'
  detectado_em TEXT NOT NULL,
  UNIQUE (entrada_id, titulo_id, papel)
);

CREATE TABLE IF NOT EXISTS amostragens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fundo_id INTEGER NOT NULL REFERENCES fundos(id) ON DELETE CASCADE,
  versao TEXT NOT NULL,
  seed TEXT NOT NULL,
  regra TEXT NOT NULL,                       -- 'padrao' | 'planner' (como no Bate Lastro)
  data_de TEXT NOT NULL,
  data_ate TEXT NOT NULL,
  limite_adquiridos INTEGER NOT NULL,
  limite_vencidos INTEGER NOT NULL,
  amostra_anterior_id INTEGER REFERENCES amostragens(id) ON DELETE SET NULL,
  populacao_sha256 TEXT,
  contagem TEXT,                             -- JSON
  avisos TEXT,                               -- JSON
  manifesto TEXT,                            -- JSON
  status TEXT NOT NULL DEFAULT 'GERADA',     -- 'GERADA' | 'DESCARTADA'
  motivo_descarte TEXT,
  descartada_em TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_amostragens_fundo ON amostragens(fundo_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_amostragens_seed ON amostragens(seed);

-- Arquivos que entraram na amostra (guardados em <dados>/amostragens/<id>/insumos/<sha256>.<ext>).
CREATE TABLE IF NOT EXISTS amostragem_insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amostragem_id INTEGER NOT NULL REFERENCES amostragens(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                        -- 'ESTOQUE' | 'LIQUIDADOS' | 'AMOSTRA_ANTERIOR'
  ordem INTEGER NOT NULL,
  nome_arquivo TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  tamanho INTEGER NOT NULL,
  arquivo TEXT NOT NULL,                     -- caminho relativo à pasta da amostra
  UNIQUE (amostragem_id, tipo, ordem)
);

-- Bases já conferidas contra a BlackList (as que entram por outro caminho são varridas ao abrir a tela).
CREATE TABLE IF NOT EXISTS blacklist_varreduras (
  base_id TEXT PRIMARY KEY REFERENCES bases(id) ON DELETE CASCADE,
  varrida_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blacklist_ocorrencias_base ON blacklist_ocorrencias(base_id);
`,
  colunas: [
    { tabela: 'amostragens', coluna: 'populacao_titulos', definicao: 'INTEGER' },
    { tabela: 'amostragens', coluna: 'total_titulos', definicao: 'INTEGER' },
    // Última varredura completa da entrada (cadastro ou Reprocessar): o que aparecer depois, numa
    // base nova, conta como "nova na semana".
    { tabela: 'blacklist_entradas', coluna: 'varredura_em', definicao: 'TEXT' },
  ],
};
