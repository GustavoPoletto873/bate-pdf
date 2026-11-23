import type { Esquema } from './tipos';

/**
 * Gestão › Relatórios CVM/NIX (portfolio_informes, report_drafts e report_emissions do Bate Lastro).
 * O rascunho guarda o snapshot congelado: o que foi revisado é exatamente o que sai no arquivo.
 * Os .docx emitidos ficam em <dados>/relatorios/.
 */
export const RELATORIOS: Esquema = {
  nome: 'relatorios',
  sql: `
CREATE TABLE IF NOT EXISTS relatorio_carteiras (
  fundo_id INTEGER NOT NULL REFERENCES fundos(id) ON DELETE CASCADE,
  data_base TEXT NOT NULL,                   -- ISO yyyy-mm-dd (fim do mês)
  dados TEXT NOT NULL,                       -- JSON da carteira (linhas e classes)
  coletado_em TEXT NOT NULL,
  PRIMARY KEY (fundo_id, data_base)
);

CREATE TABLE IF NOT EXISTS relatorio_rascunhos (
  id TEXT PRIMARY KEY,
  fundo_id INTEGER NOT NULL REFERENCES fundos(id) ON DELETE CASCADE,
  data_base TEXT NOT NULL,
  base_id TEXT REFERENCES bases(id) ON DELETE SET NULL,
  antecipada INTEGER NOT NULL DEFAULT 0,
  cenario TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  escolhas TEXT NOT NULL DEFAULT '{}',
  overrides TEXT NOT NULL DEFAULT '{}',
  revisao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (fundo_id, data_base)
);

CREATE TABLE IF NOT EXISTS relatorio_emissoes (
  id TEXT PRIMARY KEY,
  rascunho_id TEXT NOT NULL REFERENCES relatorio_rascunhos(id) ON DELETE CASCADE,
  revisao INTEGER NOT NULL,
  tipo TEXT NOT NULL,                        -- 'CVM' | 'NIX'
  lote_id TEXT,
  nome_arquivo TEXT NOT NULL,
  arquivo TEXT NOT NULL,                     -- caminho relativo à pasta de dados
  sha256 TEXT NOT NULL,
  sem_pendencias INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relatorio_emissoes_lote ON relatorio_emissoes(lote_id);
`,
  colunas: [
    // Dados da administradora que os modelos CVM/NIX imprimem.
    { tabela: 'administradoras', coluna: 'razao_social', definicao: 'TEXT' },
    { tabela: 'administradoras', coluna: 'endereco', definicao: 'TEXT' },
    { tabela: 'administradoras', coluna: 'endereco_complemento', definicao: 'TEXT' },
  ],
};
