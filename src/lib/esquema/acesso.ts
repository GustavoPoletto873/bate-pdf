import type { Esquema } from './tipos';

/**
 * Login (contas próprias, como no Bate Lastro e no dashboard-lastro). São poucas contas: cada uma
 * fica numa linha, com os dados em JSON (senha em scrypt, segredo do authenticator cifrado,
 * convite só com o hash do token, sessões abertas). `acesso_tentativas` conta as tentativas
 * para o limite por minuto (login, código, convite).
 */
export const ACESSO: Esquema = {
  nome: 'acesso',
  sql: `
CREATE TABLE IF NOT EXISTS contas (
  email TEXT PRIMARY KEY,
  dados TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS acesso_tentativas (
  chave TEXT NOT NULL,
  em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acesso_tentativas ON acesso_tentativas(chave, em);
`,
};
