// Códigos do authenticator (TOTP, RFC 6238): 6 dígitos, 30 segundos, HMAC-SHA1 — o padrão
// do Google Authenticator, Microsoft Authenticator, Authy etc., igual ao do Bate Lastro.
import { createHmac, randomBytes } from "node:crypto";

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PERIODO_S = 30;
const DIGITOS = 6;
/** Aceita o código anterior e o seguinte (relógio do celular adiantado/atrasado), como o Bate Lastro. */
const JANELA = 1;

export function base32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const ch of limpo) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error("Segredo do authenticator inválido.");
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

/** Segredo novo de 160 bits, em base32 (o formato que o app de authenticator lê). */
export function gerarSegredo(): string {
  return base32(randomBytes(20));
}

export function passoAtual(agoraMs = Date.now()): number {
  return Math.floor(agoraMs / 1000 / PERIODO_S);
}

export function codigo(segredo: string, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = createHmac("sha1", deBase32(segredo)).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

/**
 * Confere o código. Devolve o passo aceito (para guardar e não aceitar o mesmo código de
 * novo) ou null. `ultimoPasso`: o último passo já usado por essa pessoa.
 */
export function conferirCodigo(segredo: string, digitado: string, ultimoPasso = -1, agoraMs = Date.now()): number | null {
  const limpo = digitado.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpo)) return null;
  const atual = passoAtual(agoraMs);
  for (let d = -JANELA; d <= JANELA; d++) {
    const passo = atual + d;
    if (passo <= ultimoPasso) continue; // código já usado (ou anterior a um usado)
    if (codigo(segredo, passo) === limpo) return passo;
  }
  return null;
}

/** Endereço otpauth:// do QR code. */
export function uriOtpauth(segredo: string, conta: string, emissor = "Lastro Bate PDF"): string {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  const q = new URLSearchParams({ secret: segredo, issuer: emissor, algorithm: "SHA1", digits: String(DIGITOS), period: String(PERIODO_S) });
  return `otpauth://totp/${rotulo}?${q.toString()}`;
}
