import { NextResponse, type NextRequest } from "next/server";

import { loginObrigatorio, normalizarEmail, problemaDeConfiguracao, segredoSessao } from "@/lib/auth/config";
import { conferirSenha, tokenAleatorio } from "@/lib/auth/cripto";
import { COOKIE_DESAFIO, MINUTOS_DESAFIO, opcoesCookieDesafio, selarDesafio } from "@/lib/auth/desafio";
import { bloqueado, cookieSeguro, ipDe, limitar, origemRecusada, registrarFalha, respostaDeErro } from "@/lib/auth/requisicao";
import { buscarUsuario } from "@/lib/auth/usuarios";

/** Primeiro passo: e-mail + senha. Se baterem, pede o código do authenticator. */
export async function POST(request: NextRequest) {
  const recusado = origemRecusada(request);
  if (recusado) return recusado;
  if (!loginObrigatorio()) return Response.json({ erro: "O login está desligado neste computador." }, { status: 400 });
  const problema = problemaDeConfiguracao();
  if (problema) return Response.json({ erro: `O login do Lastro não está configurado: ${problema}` }, { status: 503 });

  const b = (await request.json().catch(() => ({}))) as { email?: unknown; senha?: unknown };
  const email = normalizarEmail(typeof b.email === "string" ? b.email : "");
  const senha = typeof b.senha === "string" ? b.senha : "";
  if (!email || !senha || email.length > 200 || senha.length > 200) {
    return Response.json({ erro: "Informe o e-mail e a senha." }, { status: 400 });
  }

  try {
    // Por IP (como o Bate Lastro) e por e-mail + IP: quem erra a senha dos outros de outro lugar
    // não trava o login da pessoa. O teto por e-mail (só falhas, de qualquer lugar) é bem mais alto,
    // contra adivinhação espalhada por muitos IPs.
    const ip = ipDe(request);
    const limite =
      (await limitar([
        { chave: `login:ip:${ip}`, maximo: 10, janelaS: 60 },
        { chave: `login:email-ip:${email}:${ip}`, maximo: 10, janelaS: 900 },
      ])) ?? (await bloqueado(`login:falhas:${email}`, 100, 900));
    if (limite) return limite;

    const u = await buscarUsuario(email);
    // Confere a senha mesmo sem conta (mesmo tempo de resposta: não denuncia quem tem conta).
    const certa = await conferirSenha(senha, u?.senha);
    if (!u || !certa) {
      await registrarFalha(`login:falhas:${email}`);
      return Response.json({ erro: "E-mail ou senha incorretos." }, { status: 401 });
    }
    if (!u.ativo) {
      return Response.json({ erro: "Sua conta foi desativada. Fale com um administrador do Lastro." }, { status: 403 });
    }
    if (!u.totp) {
      return Response.json(
        { erro: "Sua conta ainda não tem o authenticator configurado. Use o link de acesso que você recebeu ou peça um novo a um administrador." },
        { status: 403 },
      );
    }

    const r = NextResponse.json({ etapa: "codigo", validoPor: MINUTOS_DESAFIO * 60 });
    r.cookies.set(
      COOKIE_DESAFIO,
      selarDesafio({ email: u.email, exp: Date.now() + MINUTOS_DESAFIO * 60_000, n: tokenAleatorio(12) }, segredoSessao()),
      opcoesCookieDesafio(cookieSeguro(request)),
    );
    return r;
  } catch (erro) {
    return respostaDeErro(erro, "auth/login");
  }
}
