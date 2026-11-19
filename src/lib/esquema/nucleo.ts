import type { Esquema } from './tipos';

/** Núcleo do Bater PDF: bases, títulos, pendências (unmatch), marcações, PDFs e vínculos (match). */
export const NUCLEO: Esquema = {
  nome: 'nucleo',
  sql: `
CREATE TABLE IF NOT EXISTS bases (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  nome_fundo TEXT,
  cnpj_fundo TEXT,
  data_referencia TEXT,
  administradora TEXT,
  origem TEXT NOT NULL,              -- 'resultados_matching' | 'amostra'
  arquivo_origem TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS titulos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  linha_origem INTEGER,
  id_base_origem INTEGER,            -- ID_BASE do Bate Lastro (quando veio do resultados_matching)
  numero_documento TEXT,
  sacado_nome TEXT,
  sacado_documento TEXT,
  cedente_nome TEXT,
  cedente_documento TEXT,
  valor_total TEXT,
  valor_aquisicao TEXT,
  data_emissao TEXT,
  data_vencimento TEXT,
  data_aquisicao TEXT,
  nome_fundo TEXT,
  cnpj_fundo TEXT,
  tipo_recebivel TEXT,
  chave_nfe TEXT
);
CREATE INDEX IF NOT EXISTS idx_titulos_base ON titulos(base_id);

-- Uma pendência por título e lado (Termo/Lastro), como o unmatch do Bate Lastro.
CREATE TABLE IF NOT EXISTS pendencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  titulo_id INTEGER NOT NULL REFERENCES titulos(id) ON DELETE CASCADE,
  lado TEXT NOT NULL CHECK (lado IN ('termo','lastro')),
  -- pendente: falta bater | vinculado: batido aqui | ja_batido: veio batido do Bate Lastro
  situacao TEXT NOT NULL DEFAULT 'pendente',
  UNIQUE (titulo_id, lado)
);
CREATE INDEX IF NOT EXISTS idx_pendencias_base ON pendencias(base_id, situacao);

-- V/D/P por campo, antes e depois do vínculo (marcacao_manual_campo do Bate Lastro).
CREATE TABLE IF NOT EXISTS marcacoes (
  pendencia_id INTEGER NOT NULL REFERENCES pendencias(id) ON DELETE CASCADE,
  campo TEXT NOT NULL,
  valor TEXT NOT NULL CHECK (valor IN ('V','D','P')),
  valor_digitado TEXT,               -- D: o que o documento traz ('' = o documento não traz)
  origem TEXT NOT NULL DEFAULT 'manual',
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (pendencia_id, campo)
);

CREATE TABLE IF NOT EXISTS pdfs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  nome_arquivo TEXT NOT NULL,
  caminho_relativo TEXT,
  sha256 TEXT NOT NULL,
  tamanho INTEGER NOT NULL,
  total_paginas INTEGER,
  paginas_com_texto INTEGER,
  status TEXT NOT NULL DEFAULT 'pendente',  -- pendente | indexando | indexado | sem_texto | falhou
  erro TEXT,
  tipo_declarado TEXT,               -- null | 'termo' | 'lastro'
  enviado_em TEXT NOT NULL,
  indexado_em TEXT,
  UNIQUE (base_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_pdfs_base ON pdfs(base_id, status);

CREATE TABLE IF NOT EXISTS paginas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pdf_id INTEGER NOT NULL REFERENCES pdfs(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  texto TEXT NOT NULL,
  texto_normalizado TEXT NOT NULL,
  UNIQUE (pdf_id, numero)
);

-- Busca "tipo grep" (o pg_trgm do Bate Lastro): LIKE '%termo%' usa o índice de trigramas.
CREATE VIRTUAL TABLE IF NOT EXISTS paginas_fts USING fts5(
  texto_normalizado, content='paginas', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS paginas_ai AFTER INSERT ON paginas BEGIN
  INSERT INTO paginas_fts(rowid, texto_normalizado) VALUES (new.id, new.texto_normalizado);
END;
CREATE TRIGGER IF NOT EXISTS paginas_ad AFTER DELETE ON paginas BEGIN
  INSERT INTO paginas_fts(paginas_fts, rowid, texto_normalizado) VALUES ('delete', old.id, old.texto_normalizado);
END;

-- Vínculo pendência ↔ PDF (o match do Bate Lastro), com o veredito e a leitura por campo.
CREATE TABLE IF NOT EXISTS vinculos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pendencia_id INTEGER NOT NULL UNIQUE REFERENCES pendencias(id) ON DELETE CASCADE,
  pdf_id INTEGER REFERENCES pdfs(id) ON DELETE SET NULL,
  pagina INTEGER,
  marcacoes TEXT NOT NULL,           -- JSON {campo: 'V'|'D'|'P'}
  leitura TEXT NOT NULL,             -- JSON {campo: valor no documento}
  origem TEXT NOT NULL,              -- 'manual' | 'conferencia'
  usuario TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pre_classificacoes (
  base_id TEXT PRIMARY KEY REFERENCES bases(id) ON DELETE CASCADE,
  executado_em TEXT NOT NULL,
  duracao_ms INTEGER,
  resultado TEXT NOT NULL
);
`,
  colunas: [
    // Bate Lastro: a base pertence a um fundo e tem status de auditoria (a iniciar / em andamento / finalizada).
    { tabela: 'bases', coluna: 'fundo_id', definicao: 'INTEGER REFERENCES fundos(id) ON DELETE SET NULL' },
    { tabela: 'bases', coluna: 'modo_referencia', definicao: "TEXT NOT NULL DEFAULT 'DATA_REFERENCIA'" },
    { tabela: 'bases', coluna: 'finalizada', definicao: 'INTEGER NOT NULL DEFAULT 0' },
    { tabela: 'bases', coluna: 'finalizada_em', definicao: 'TEXT' },
    { tabela: 'titulos', coluna: 'operacao_id', definicao: 'TEXT' },
    // O vínculo é o match do Bate Lastro: pode apontar para a leitura (IA, Bater PDF ou planilha) que bateu.
    { tabela: 'vinculos', coluna: 'leitura_id', definicao: 'INTEGER REFERENCES leituras(id) ON DELETE SET NULL' },
    { tabela: 'vinculos', coluna: 'tipo_match', definicao: "TEXT NOT NULL DEFAULT 'manual'" },
    { tabela: 'vinculos', coluna: 'similaridade', definicao: 'REAL' },
  ],
};
