// Desafio do segundo passo do login (como o mfa_challenges do Bate Lastro): depois da senha
// certa, um cookie cifrado de 3 minutos diz de quem é o código esperado. Cada desafio vale uma
// vez (a conta guarda o último usado).
import { cifrar, decifrar } from "./cifra";

export const COOKIE_DESAFIO = "batepdf_desafio";
export const MINUTOS_DESAFIO = 3;

export interface Desafio {
  email: string;
  exp: number;
  n: string;
}

export function selarDesafio(d: Desafio, segredo: string): string {
  return cifrar(JSON.stringify(d), segredo, "desafio");
}

export function abrirDesafio(valor: string | undefined, segredo: string, agora = Date.now()): Desafio | null {
  const json = decifrar(valor, segredo, "desafio");
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Desafio;
    return d?.email && d.n && d.exp > agora ? d : null;
  } catch {
    return null;
  }
}

export function opcoesCookieDesafio(seguro: boolean) {
  return { httpOnly: true, sameSite: "strict" as const, secure: seguro, path: "/api/auth", maxAge: MINUTOS_DESAFIO * 60 };
}
