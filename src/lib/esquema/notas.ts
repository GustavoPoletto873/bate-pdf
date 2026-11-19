import type { Esquema } from './tipos';

/**
 * Análise › NF Status ("registroNotaFiscal" do Bate Lastro): a situação de cada NF-e da base.
 * Vem de dois lugares: o XML da nota lido no Anexo (cStat do protocolo) e a consulta no
 * SERPRO pela chave (quando as chaves SERPRO_* estão no .env.local). Uma linha por chave × base,
 * com a consulta mais recente.
 */
export const NOTAS: Esquema = {
  nome: 'notas',
  sql: `
CREATE TABLE IF NOT EXISTS notas_fiscais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave_nfe TEXT NOT NULL,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  status_nfe TEXT NOT NULL,                  -- 'Ativa' | 'Cancelada' | 'Erro'
  origem TEXT NOT NULL,                      -- 'xml_anexo' | 'serpro'
  mensagem TEXT,                             -- motivo do erro da consulta
  xml_content TEXT,
  consulta_data TEXT NOT NULL,
  UNIQUE (chave_nfe, base_id)
);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_base ON notas_fiscais(base_id);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_status ON notas_fiscais(status_nfe);
`,
};
