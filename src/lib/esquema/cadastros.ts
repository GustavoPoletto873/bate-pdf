import type { Esquema } from './tipos';

/** Gestão › Fundos: fundos e administradoras (investment_funds / fund_administrators do Bate Lastro). */
export const CADASTROS: Esquema = {
  nome: 'cadastros',
  sql: `
CREATE TABLE IF NOT EXISTS administradoras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_administradoras_nome ON administradoras(nome COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS fundos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cnpj TEXT NOT NULL UNIQUE,                 -- 14 dígitos, sem máscara
  tipo TEXT NOT NULL DEFAULT 'FIDC' CHECK (tipo IN ('FIDC','FIC_FIDC')),
  administradora_id INTEGER REFERENCES administradoras(id) ON DELETE SET NULL,
  gestor TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fundos_administradora ON fundos(administradora_id);
`,
};
