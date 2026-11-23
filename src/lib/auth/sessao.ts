// Cookie de sessão: httpOnly, criptografado (AES-256-GCM). Guarda só quem é e o id da sessão;
// a sessão em si fica registrada na conta (lista de sessões), então sair, trocar a senha ou
// desativar a conta derruba o acesso na hora — o mesmo efeito da revogação de refresh tokens
// do Bate Lastro.

import { cifrar, decifrar } from "./cifra";

export const COOKIE_SESSAO = "batepdf_sessao";
/** Sem usar o Lastro por este tempo, a pessoa entra de novo (o refresh do Bate Lastro dura 30 dias). */
export const DIAS_SEM_USO = 30;
const MS_SEM_USO = DIAS_SEM_USO * 86_400_000;

export interface Sessao {
  v: 2;
  email: string;
  sid: string;
  /** Último uso registrado (ms). */
  visto: number;
}

export function selar(s: Sessao, segredo: string): string {
  return cifrar(JSON.stringify(s), segredo, "sessao");
}

export function abrir(valor: string | undefined | null, segredo: string, agora = Date.now()): Sessao | null {
  const json = decifrar(valor, segredo, "sessao");
  if (!json) return null;
  try {
    const s = JSON.parse(json) as Sessao;
    if (s?.v !== 2 || !s.email || !s.sid || typeof s.visto !== "number") return null;
    return s.visto + MS_SEM_USO > agora ? s : null;
  } catch {
    return null;
  }
}

export function opcoesCookie(seguro: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: seguro,
    path: "/",
    maxAge: DIAS_SEM_USO * 86_400,
  };
}
