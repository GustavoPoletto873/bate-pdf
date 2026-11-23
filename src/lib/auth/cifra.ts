// Cifra AES-256-GCM dos dados guardados e do cookie de sessão. Sem "server-only" porque o
// proxy (que também roda no servidor) usa para abrir o cookie.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Uma chave por finalidade, derivada do SESSAO_SEGREDO (HKDF): a do cookie não abre o
// segredo do authenticator e vice-versa.

export type Finalidade = "sessao" | "totp" | "desafio";

function chave(segredo: string, finalidade: Finalidade): Buffer {
  return Buffer.from(hkdfSync("sha256", segredo, "bate-pdf", finalidade, 32));
}

export function cifrar(texto: string, segredo: string, finalidade: Finalidade): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(segredo, finalidade), iv);
  const corpo = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), corpo]).toString("base64url");
}

/** Devolve null se o texto foi adulterado ou cifrado com outro segredo/finalidade. */
export function decifrar(valor: string | null | undefined, segredo: string, finalidade: Finalidade): string | null {
  if (!valor || !segredo) return null;
  try {
    const bruto = Buffer.from(valor, "base64url");
    const d = createDecipheriv("aes-256-gcm", chave(segredo, finalidade), bruto.subarray(0, 12));
    d.setAuthTag(bruto.subarray(12, 28));
    return Buffer.concat([d.update(bruto.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
