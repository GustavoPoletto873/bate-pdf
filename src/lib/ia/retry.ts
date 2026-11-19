import { randomUUID } from 'node:crypto';
import type { ClienteGemini } from './cliente';
import type { ResultadoValidacao } from './esquema';

/**
 * Port do services/gemini_with_retry.py do Bate Lastro:
 * - o PDF sobe uma vez; até 3 tentativas de generate_content com o schema da resposta;
 * - erro de validação volta para o Gemini no prompt da tentativa seguinte;
 * - JSON inválido (resposta truncada) não tenta de novo;
 * - PDF grande demais para o modelo não tenta de novo;
 * - 429 RESOURCE_EXHAUSTED marca o modelo como esgotado até o retryDelay (sem fallback);
 * - toda tentativa que gerou resposta é cobrada: os tokens vão junto na falha
 *   (FalhaGeminiComCusto), para o uso_ia registrar o custo real.
 */

export type Tentativa = { modelo: string; tokensEntrada: number; tokensSaida: number };

/** Falha final depois de tentativas que já foram cobradas. */
export class FalhaGeminiComCusto extends Error {
  constructor(public causa: Error, public tentativas: Tentativa[], public tipo: 'json' | 'validacao' | 'outro') {
    super(causa.message);
  }
}

/** Erro que não adianta repetir agora (sem custo de geração). */
export class ErroGemini extends Error {
  constructor(mensagem: string, public tipo: 'cota' | 'grande_demais' | 'chave' | 'envio') {
    super(mensagem);
  }
}

type Global = typeof globalThis & { __batePdfCotaGemini?: Map<string, number> };

function esgotados(): Map<string, number> {
  const g = globalThis as Global;
  g.__batePdfCotaGemini ??= new Map();
  return g.__batePdfCotaGemini;
}

/** ModelQuotaManager: o modelo está disponível agora? */
export function modeloDisponivel(modelo: string, agora = Date.now()): boolean {
  const ate = esgotados().get(modelo);
  if (ate === undefined) return true;
  if (agora >= ate) {
    esgotados().delete(modelo);
    return true;
  }
  return false;
}

export function marcarEsgotado(modelo: string, segundos: number, agora = Date.now()): void {
  esgotados().set(modelo, agora + segundos * 1000);
}

export function esgotadoAte(modelo: string): number | null {
  return esgotados().get(modelo) ?? null;
}

/** _parse_retry_delay: segundos até a cota voltar (1 h se não der para ler). */
export function segundosAteACota(mensagem: string): number {
  let m = /['"]retryDelay['"]\s*:\s*['"](\d+)s['"]/.exec(mensagem);
  if (m) return Number(m[1]);
  m = /retry\s+in\s+(\d+)h(\d+)m/i.exec(mensagem);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = /retry\s+in\s+(\d+)m/i.exec(mensagem);
  if (m) return Number(m[1]) * 60;
  return 3600;
}

export const ehErroDeCota = (msg: string) => msg.toUpperCase().includes('429') && msg.toUpperCase().includes('RESOURCE_EXHAUSTED');

export const ehDocumentoGrandeDemais = (msg: string) => {
  const u = msg.toUpperCase();
  return u.includes('EXCEEDS THE SUPPORTED PAGE LIMIT') || u.includes('INPUT TOKEN COUNT EXCEEDS THE MAXIMUM');
};

/** Chave recusada pelo Google (local: não adianta repetir 3 vezes). */
export const ehChaveRecusada = (msg: string) => /API_KEY_INVALID|API key not valid|API key expired|PERMISSION_DENIED/i.test(msg);

const horario = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export type ParametrosRetry<T> = {
  cliente: ClienteGemini;
  pdf: Uint8Array;
  prompt: string;
  esquema: object;
  validar: (json: unknown) => ResultadoValidacao<T>;
  modelo: string;
  maxTentativas?: number;
  esperaMs?: number;
  esperar?: (ms: number) => Promise<void>;
};

const esperarPadrao = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

export async function gerarComRetry<T>(p: ParametrosRetry<T>): Promise<{ valor: T; bruto: unknown; tentativas: Tentativa[] }> {
  const max = p.maxTentativas ?? 3;
  const esperaMs = p.esperaMs ?? 1000;
  const esperar = p.esperar ?? esperarPadrao;
  if (!modeloDisponivel(p.modelo)) {
    throw new ErroGemini(`Cota do Gemini esgotada para o modelo ${p.modelo}. Volta por volta das ${horario(esgotadoAte(p.modelo)!)}.`, 'cota');
  }

  let arquivo;
  try {
    arquivo = await p.cliente.enviarPdf(p.pdf, `file_uploaded_${randomUUID()}.pdf`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (ehChaveRecusada(msg)) throw new ErroGemini('O Google recusou a chave do Gemini.', 'chave');
    if (ehErroDeCota(msg)) {
      marcarEsgotado(p.modelo, segundosAteACota(msg));
      throw new ErroGemini(`Cota do Gemini esgotada para o modelo ${p.modelo}.`, 'cota');
    }
    throw new ErroGemini(`Falha ao enviar o PDF para o Gemini: ${msg}`, 'envio');
  }

  const tentativas: Tentativa[] = [];
  let prompt = p.prompt;
  try {
    for (let tentativa = 0; tentativa < max; tentativa++) {
      try {
        const r = await p.cliente.gerarJson({ modelo: p.modelo, prompt, arquivo, esquema: p.esquema });
        if (r.uso) tentativas.push({ modelo: p.modelo, ...r.uso });
        let json: unknown;
        try {
          json = JSON.parse(r.texto);
        } catch {
          throw new FalhaGeminiComCusto(
            new Error('Resposta do Gemini não é um JSON válido (provável truncamento por tamanho)'), tentativas, 'json');
        }
        const v = p.validar(json);
        if (v.ok) return { valor: v.valor, bruto: json, tentativas };
        const info = v.erros.join('; ');
        if (tentativa < max - 1) {
          prompt += `\n\nIMPORTANTE: Na tentativa anterior houve erro de validação: ${info}. Por favor, corrija estes problemas.`;
          await esperar(esperaMs);
          continue;
        }
        throw new FalhaGeminiComCusto(new Error(info), tentativas, 'validacao');
      } catch (e) {
        if (e instanceof FalhaGeminiComCusto) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (ehDocumentoGrandeDemais(msg)) throw new ErroGemini('O PDF é grande demais para o Gemini (limite de páginas ou de tokens).', 'grande_demais');
        if (ehChaveRecusada(msg)) throw new ErroGemini('O Google recusou a chave do Gemini.', 'chave');
        if (ehErroDeCota(msg)) {
          marcarEsgotado(p.modelo, segundosAteACota(msg));
          throw new ErroGemini(`Cota do Gemini esgotada para o modelo ${p.modelo}.`, 'cota');
        }
        if (tentativa < max - 1) {
          await esperar(esperaMs);
          continue;
        }
        throw new FalhaGeminiComCusto(e instanceof Error ? e : new Error(msg), tentativas, 'outro');
      }
    }
    throw new FalhaGeminiComCusto(new Error(`Falha após ${max} tentativas`), tentativas, 'outro');
  } finally {
    // O Google apaga sozinho em 48 h; apagar já é só higiene (falha aqui não importa).
    p.cliente.apagar?.(arquivo).catch(() => {});
  }
}
