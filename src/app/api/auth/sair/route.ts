import { NextResponse, type NextRequest } from "next/server";

import { segredoSessao } from "@/lib/auth/config";
import { origemRecusada } from "@/lib/auth/requisicao";
import { abrir, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { alterarUsuarios } from "@/lib/auth/usuarios";

/** Sai do Lastro: encerra esta sessão na conta e apaga o cookie. */
export async function POST(request: NextRequest) {
  const recusado = origemRecusada(request);
  if (recusado) return recusado;
  const s = abrir(request.cookies.get(COOKIE_SESSAO)?.value, segredoSessao());
  if (s) {
    await alterarUsuarios((lista) => {
      const u = lista.find((x) => x.email === s.email);
      if (u) u.sessoes = u.sessoes.filter((x) => x.id !== s.sid);
    }).catch(() => null);
  }
  const r = NextResponse.json({ ok: true });
  r.cookies.delete({ name: COOKIE_SESSAO, path: "/" });
  return r;
}
