import { NextResponse, type NextRequest } from "next/server";

import { problemaDeConfiguracao, segredoSessao } from "@/lib/auth/config";
import { decifrar } from "@/lib/auth/cripto";
import { abrirDesafio, COOKIE_DESAFIO } from "@/lib/auth/desafio";
import { cookieSeguro, ipDe, limitar, origemRecusada, respostaDeErro } from "@/lib/auth/requisicao";
import { COOKIE_SESSAO, opcoesCookie, selar } from "@/lib/auth/sessao";
import { conferirCodigo } from "@/lib/auth/totp";
import { abrirSessaoNaConta, alterarUsuarios, ErroContas, podeEntrar } from "@/lib/auth/usuarios";

/** Segundo passo: o código de 6 dígitos do authenticator. Abre a sessão. */
export async function POST(request: NextRequest) {
  const recusado = origemRecusada(request);
  if (recusado) return recusado;
  const problema = problemaDeConfiguracao();
  if (problema) return Response.json({ erro: `O login do Lastro não está configurado: ${problema}` }, { status: 503 });

  const segredo = segredoSessao();
  const desafio = abrirDesafio(request.cookies.get(COOKIE_DESAFIO)?.value, segredo);
  if (!desafio) {
    return Response.json({ erro: "O tempo para digitar o código acabou. Entre com a senha de novo.", reiniciar: true }, { status: 401 });
  }
  const b = (await request.json().catch(() => ({}))) as { codigo?: unknown };
  const codigo = typeof b.codigo === "string" ? b.codigo.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(codigo)) return Response.json({ erro: "Digite os 6 dígitos do authenticator." }, { status: 400 });

  try {
    const limite = await limitar([
      { chave: `codigo:ip:${ipDe(request)}`, maximo: 10, janelaS: 60 },
      { chave: `codigo:email:${desafio.email}`, maximo: 10, janelaS: 900 },
    ]);
    if (limite) return limite;

    const sid = await alterarUsuarios((lista) => {
      const u = lista.find((x) => x.email === desafio.email);
      if (!u || !podeEntrar(u)) throw new ErroContas("Sua conta não pode entrar agora. Fale com um administrador do Lastro.", 403);
      if (u.ultimoDesafio === desafio.n) throw new ErroContas("Este login já foi concluído. Entre com a senha de novo.", 410);
      const segredoTotp = decifrar(u.totp, segredo, "totp");
      if (!segredoTotp) {
        throw new ErroContas("Não foi possível conferir seu authenticator (a chave do Lastro mudou). Peça um novo link de acesso a um administrador.", 409);
      }
      const passo = conferirCodigo(segredoTotp, codigo, u.ultimoPasso);
      if (passo === null) {
        throw new ErroContas("Código inválido ou já usado. Confira se é o código de “Lastro Bate PDF” ou espere o próximo (muda a cada 30 s).", 401);
      }
      u.ultimoPasso = passo;
      u.ultimoDesafio = desafio.n;
      return abrirSessaoNaConta(u, request.headers.get("user-agent") ?? undefined);
    });

    const r = NextResponse.json({ ok: true });
    r.cookies.set(COOKIE_SESSAO, selar({ v: 2, email: desafio.email, sid, visto: Date.now() }, segredo), opcoesCookie(cookieSeguro(request)));
    r.cookies.delete({ name: COOKIE_DESAFIO, path: "/api/auth" });
    return r;
  } catch (erro) {
    if (erro instanceof ErroContas) return Response.json({ erro: erro.message, reiniciar: erro.status !== 401 || undefined }, { status: erro.status });
    return respostaDeErro(erro, "auth/codigo");
  }
}
