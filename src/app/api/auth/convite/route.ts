import { connection, NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";

import { problemaDeConfiguracao, segredoSessao } from "@/lib/auth/config";
import { cifrar, decifrar, hashSenha, hashToken } from "@/lib/auth/cripto";
import { problemaNaSenha } from "@/lib/auth/regrasSenha";
import { cookieSeguro, ipDe, limitar, origemRecusada, respostaDeErro } from "@/lib/auth/requisicao";
import { COOKIE_SESSAO, opcoesCookie, selar } from "@/lib/auth/sessao";
import { conferirCodigo, gerarSegredo, uriOtpauth } from "@/lib/auth/totp";
import { abrirSessaoNaConta, acharPorConvite, alterarUsuarios, ErroContas, lerUsuarios } from "@/lib/auth/usuarios";

const LINK_INVALIDO =
  "Este link de acesso não vale mais (já foi usado, venceu ou foi trocado por um mais novo). Peça um novo a um administrador do Lastro.";

function semConfiguracao() {
  const problema = problemaDeConfiguracao();
  return problema ? Response.json({ erro: `O login do Lastro não está configurado: ${problema}` }, { status: 503 }) : null;
}

/** Para a tela do convite: de quem é o link e o que ele faz. O token vem no cabeçalho x-convite (fora da URL e dos logs). */
export async function GET(request: NextRequest) {
  await connection();
  const erroCfg = semConfiguracao();
  if (erroCfg) return erroCfg;
  try {
    const limite = await limitar([{ chave: `convite:ip:${ipDe(request)}`, maximo: 30, janelaS: 60 }]);
    if (limite) return limite;
    const u = acharPorConvite(await lerUsuarios(), request.headers.get("x-convite") ?? "");
    if (!u?.convite) return Response.json({ erro: LINK_INVALIDO }, { status: 410 });
    return Response.json({ email: u.email, nome: u.nome, tipo: u.convite.tipo, expira: new Date(u.convite.expira).toISOString() });
  } catch (erro) {
    return respostaDeErro(erro, "auth/convite");
  }
}

/**
 * Duas etapas, como o cadastro por convite do Bate Lastro:
 *   { etapa: "senha", token, senha }   → guarda a senha e devolve o QR code do authenticator;
 *   { etapa: "codigo", token, codigo } → confere o primeiro código, ativa a conta e já entra.
 * Diferente do Bate Lastro, o authenticator só passa a valer depois de um código certo.
 */
export async function POST(request: NextRequest) {
  const recusado = origemRecusada(request);
  if (recusado) return recusado;
  const erroCfg = semConfiguracao();
  if (erroCfg) return erroCfg;

  const b = (await request.json().catch(() => ({}))) as { etapa?: unknown; token?: unknown; senha?: unknown; codigo?: unknown };
  const token = typeof b.token === "string" ? b.token : "";
  const segredo = segredoSessao();

  try {
    const limite = await limitar([
      { chave: `convite:ip:${ipDe(request)}`, maximo: 20, janelaS: 60 },
      { chave: `convite:token:${hashToken(token).slice(0, 24)}`, maximo: 15, janelaS: 900 },
    ]);
    if (limite) return limite;

    if (b.etapa === "senha") {
      const senha = typeof b.senha === "string" ? b.senha : "";
      const problema = problemaNaSenha(senha);
      if (problema) return Response.json({ erro: problema }, { status: 400 });
      const [hash, segredoTotp] = [await hashSenha(senha), gerarSegredo()];
      const email = await alterarUsuarios((lista) => {
        const u = acharPorConvite(lista, token);
        if (!u?.convite) throw new ErroContas(LINK_INVALIDO, 410);
        u.convite.pendente = { senha: hash, totp: cifrar(segredoTotp, segredo, "totp") };
        return u.email;
      });
      const uri = uriOtpauth(segredoTotp, email);
      const qr = await QRCode.toDataURL(uri, { width: 232, margin: 1, errorCorrectionLevel: "M" });
      return Response.json({ segredo: segredoTotp, uri, qr });
    }

    if (b.etapa === "codigo") {
      const codigo = typeof b.codigo === "string" ? b.codigo.replace(/\s/g, "") : "";
      if (!/^\d{6}$/.test(codigo)) return Response.json({ erro: "Digite os 6 dígitos do authenticator." }, { status: 400 });
      const { email, sid } = await alterarUsuarios((lista) => {
        const u = acharPorConvite(lista, token);
        if (!u?.convite) throw new ErroContas(LINK_INVALIDO, 410);
        const pendente = u.convite.pendente;
        if (!pendente) throw new ErroContas("Crie a senha primeiro.", 400);
        const segredoTotp = decifrar(pendente.totp, segredo, "totp");
        if (!segredoTotp) throw new ErroContas("Recomece pelo passo da senha.", 409);
        const passo = conferirCodigo(segredoTotp, codigo);
        if (passo === null) {
          throw new ErroContas("Código inválido. Confira se escaneou o QR code desta tela e digite o código atual do app.", 401);
        }
        u.senha = pendente.senha;
        u.totp = pendente.totp;
        u.ultimoPasso = passo;
        u.convite = null;
        u.sessoes = []; // senha nova encerra as outras sessões (como o reset do Bate Lastro)
        return { email: u.email, sid: abrirSessaoNaConta(u, request.headers.get("user-agent") ?? undefined) };
      });
      const r = NextResponse.json({ ok: true });
      r.cookies.set(COOKIE_SESSAO, selar({ v: 2, email, sid, visto: Date.now() }, segredo), opcoesCookie(cookieSeguro(request)));
      return r;
    }

    return Response.json({ erro: "Etapa desconhecida." }, { status: 400 });
  } catch (erro) {
    if (erro instanceof ErroContas) return Response.json({ erro: erro.message }, { status: erro.status });
    return respostaDeErro(erro, "auth/convite");
  }
}
