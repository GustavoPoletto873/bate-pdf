import type { ClienteGemini } from './cliente';
import { esquemaJson, validarModelo } from './esquema';
import { LEITORES, MODELO_CLASSIFICACAO, PROMPT_CLASSIFICACAO, tipoClassificado } from './modelos';
import { gerarComRetry, type Tentativa } from './retry';
import { registrosDaLeitura, type RegistroLeitura } from './linhas';

/**
 * As duas etapas do Gemini no Anexo: classificar_documento (o tipo do documento) e
 * ler_documento (a extração estruturada pelo modelo do tipo).
 */

const ESQUEMA_CLASSIFICACAO = esquemaJson(MODELO_CLASSIFICACAO);
const ESQUEMAS_LEITURA = Object.fromEntries(Object.entries(LEITORES).map(([tipo, l]) => [tipo, esquemaJson(l.modelo)]));

export type Opcoes = { modelo: string; esperar?: (ms: number) => Promise<void>; esperaMs?: number };

export async function classificarDocumento(cliente: ClienteGemini, pdf: Uint8Array, opcoes: Opcoes):
  Promise<{ tipo: string; bruto: unknown; tentativas: Tentativa[] }> {
  const r = await gerarComRetry({
    cliente, pdf, prompt: PROMPT_CLASSIFICACAO, esquema: ESQUEMA_CLASSIFICACAO,
    validar: (json) => validarModelo(MODELO_CLASSIFICACAO, json), ...opcoes,
  });
  return { tipo: tipoClassificado(r.valor), bruto: r.bruto, tentativas: r.tentativas };
}

/** Tipos com leitura por IA (o doc_config do main_lastro.py, sem o CT-e). */
export const tiposComLeitura = () => Object.keys(LEITORES);

export async function lerDocumento(cliente: ClienteGemini, pdf: Uint8Array, tipo: string, opcoes: Opcoes):
  Promise<{ registros: RegistroLeitura[]; dados: Record<string, unknown>; tentativas: Tentativa[] }> {
  const leitor = LEITORES[tipo];
  if (!leitor) throw new Error(`Tipo sem leitura por IA: ${tipo}`);
  const r = await gerarComRetry({
    cliente, pdf, prompt: leitor.prompt, esquema: ESQUEMAS_LEITURA[tipo],
    validar: (json) => validarModelo(leitor.modelo, json), ...opcoes,
  });
  return { registros: registrosDaLeitura(r.valor), dados: r.valor, tentativas: r.tentativas };
}

export function somarTentativas(tentativas: Tentativa[]): { tokensEntrada: number; tokensSaida: number } {
  return tentativas.reduce((a, t) => ({ tokensEntrada: a.tokensEntrada + t.tokensEntrada, tokensSaida: a.tokensSaida + t.tokensSaida }),
    { tokensEntrada: 0, tokensSaida: 0 });
}
