/**
 * Configuração da leitura por IA (Gemini), como backend/config/settings.py do Bate Lastro
 * (APISettings): a classificação e a leitura usam o mesmo modelo, `gemini-3.1-flash-lite`.
 *
 * A chave fica em `.env.local` (GEMINI_API_KEY), que o Next carrega ao iniciar e o .gitignore
 * já ignora. A chave nunca é mostrada nem registrada no log: só se ela existe.
 */

/** Modelo padrão do Bate Lastro (DEFAULT_CLASSIFICATION_MODEL e DEFAULT_READING_MODEL). */
export const MODELO_PADRAO = 'gemini-3.1-flash-lite';

/** Preço por token, em dólar (GEMINI_MODELS do Bate Lastro). Modelo fora da tabela: só os tokens. */
export const PRECOS_POR_TOKEN: Record<string, { entrada: number; saida: number }> = {
  'gemini-3.1-flash-lite': { entrada: 0.00000025, saida: 0.0000015 },
};

/** PDFs acima disso nunca vão para o Gemini (MAX_PAGINAS_IA do Bate Lastro). */
export const MAX_PAGINAS_IA_PADRAO = 50;

export const MENSAGEM_SEM_CHAVE = 'Configure a chave do Gemini (GEMINI_API_KEY) para ler os documentos';

/** Primeira variável preenchida. Aceita também os nomes do .env do Bate Lastro (config/settings.py). */
function primeira(...nomes: string[]): string | null {
  for (const n of nomes) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return null;
}

export function chaveGemini(): string | null {
  return primeira('GEMINI_API_KEY', 'GOOGLE_API_KEY');
}

export function modeloGemini(): string {
  return primeira('GEMINI_MODELO', 'DEFAULT_READING_MODEL', 'DEFAULT_CLASSIFICATION_MODEL') || MODELO_PADRAO;
}

export function maxPaginasIa(): number {
  const n = Number(process.env.MAX_PAGINAS_IA);
  return Number.isInteger(n) && n > 0 ? n : MAX_PAGINAS_IA_PADRAO;
}

/** Custo em dólar de uma chamada; null quando o modelo não está na tabela de preços. */
export function custoUsd(modelo: string, tokensEntrada: number, tokensSaida: number): number | null {
  const preco = PRECOS_POR_TOKEN[modelo];
  if (!preco) return null;
  return tokensEntrada * preco.entrada + tokensSaida * preco.saida;
}

export type StatusGemini = {
  configurada: boolean;
  modelo: string;
  modelo_padrao: string;
  max_paginas: number;
  preco_conhecido: boolean;
};

export function statusGemini(): StatusGemini {
  const modelo = modeloGemini();
  return {
    configurada: chaveGemini() !== null,
    modelo,
    modelo_padrao: MODELO_PADRAO,
    max_paginas: maxPaginasIa(),
    preco_conhecido: modelo in PRECOS_POR_TOKEN,
  };
}

/** Tira a chave de qualquer texto que vá para o log ou para a tela (mensagens de erro do SDK). */
export function semSegredo(texto: string): string {
  const chave = chaveGemini();
  let t = chave ? texto.split(chave).join('***') : texto;
  t = t.replace(/AIza[0-9A-Za-z_-]{20,}/g, '***');
  return t;
}
