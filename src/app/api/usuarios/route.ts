import { connection, type NextRequest } from "next/server";

import { emailPermitido, normalizarEmail } from "@/lib/auth/config";
import { exigirAdmin, origemRecusada, respostaDeErro } from "@/lib/auth/requisicao";
import {
  adminsAtivos,
  alterarUsuarios,
  ErroContas,
  lerUsuarios,
  novoConvite,
  publico,
  type Perfil,
  type Usuario,
} from "@/lib/auth/usuarios";

// Administração das contas do Lastro (só administradores).

function linkDe(request: NextRequest, token: string) {
  // Token no fragmento (#): o navegador não o envia ao servidor (fica fora de logs e do Referer).
  return `${request.nextUrl.origin}/convite#t=${encodeURIComponent(token)}`;
}

function perfilValido(v: unknown): v is Perfil {
  return v === "admin" || v === "usuario";
}

function responderErro(erro: unknown) {
  if (erro instanceof ErroContas) return Response.json({ erro: erro.message }, { status: erro.status });
  return respostaDeErro(erro, "usuarios");
}

async function admin(request: NextRequest, mudando: boolean) {
  if (mudando) {
    const recusado = origemRecusada(request);
    if (recusado) return { ok: false as const, resposta: recusado };
  }
  return exigirAdmin();
}

export async function GET(request: NextRequest) {
  await connection();
  try {
    const s = await admin(request, false);
    if (!s.ok) return s.resposta;
    const agora = Date.now();
    const usuarios = (await lerUsuarios()).map((u) => publico(u, agora)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return Response.json({ usuarios, eu: s.quem.email });
  } catch (erro) {
    return responderErro(erro);
  }
}

/** Convida uma pessoa: cria a conta e devolve o link (mostrado uma vez só). */
export async function POST(request: NextRequest) {
  try {
    const s = await admin(request, true);
    if (!s.ok) return s.resposta;
    const b = (await request.json().catch(() => ({}))) as { email?: unknown; nome?: unknown; perfil?: unknown };
    const email = normalizarEmail(typeof b.email === "string" ? b.email : "");
    const nome = typeof b.nome === "string" ? b.nome.trim().slice(0, 80) : "";
    const perfil: Perfil = perfilValido(b.perfil) ? b.perfil : "usuario";
    if (!emailPermitido(email)) {
      return Response.json({ erro: "Só e-mails da Denver (ou os liberados em ACESSO_EMAILS) podem ter conta." }, { status: 400 });
    }
    if (nome.length < 2) return Response.json({ erro: "Informe o nome da pessoa." }, { status: 400 });

    const { token, usuario } = await alterarUsuarios((lista) => {
      if (lista.some((u) => u.email === email)) throw new ErroContas("Já existe uma conta com esse e-mail.", 409);
      const agora = Date.now();
      const { token, convite } = novoConvite("cadastro", s.quem.email, agora);
      const u: Usuario = {
        email,
        nome,
        perfil,
        ativo: true,
        senha: null,
        totp: null,
        ultimoPasso: -1,
        convite,
        sessoes: [],
        criadoEm: agora,
        criadoPor: s.quem.email,
        ultimoAcesso: null,
      };
      lista.push(u);
      return { token, usuario: publico(u, agora) };
    });
    return Response.json({ usuario, link: linkDe(request, token) });
  } catch (erro) {
    return responderErro(erro);
  }
}

type Acao = "link" | "desativar" | "reativar" | "perfil" | "encerrar" | "cancelar_convite";
const ACOES: Acao[] = ["link", "desativar", "reativar", "perfil", "encerrar", "cancelar_convite"];

/** Ações numa conta. "link" gera um link novo (cadastro ou redefinição de senha + authenticator). */
export async function PATCH(request: NextRequest) {
  try {
    const s = await admin(request, true);
    if (!s.ok) return s.resposta;
    const b = (await request.json().catch(() => ({}))) as { email?: unknown; acao?: unknown; perfil?: unknown };
    const email = normalizarEmail(typeof b.email === "string" ? b.email : "");
    const acao = ACOES.find((a) => a === b.acao);
    if (!acao) return Response.json({ erro: "Ação desconhecida." }, { status: 400 });
    const eu = s.quem.email;

    const resultado = await alterarUsuarios((lista) => {
      const u = lista.find((x) => x.email === email);
      if (!u) throw new ErroContas("Conta não encontrada.", 404);
      const agora = Date.now();
      const ficaSemAdmin = () => adminsAtivos(lista).filter((x) => x.email !== u.email).length === 0;
      let token: string | null = null;

      switch (acao) {
        case "link": {
          if (!u.ativo) throw new ErroContas("Reative a conta antes de gerar um link.", 400);
          const tipo = u.senha && u.totp ? "redefinir" : "cadastro";
          const novo = novoConvite(tipo, eu ?? "", agora);
          u.convite = novo.convite;
          token = novo.token;
          break;
        }
        case "desativar":
          if (u.email === eu) throw new ErroContas("Você não pode desativar a sua própria conta.", 400);
          if (u.perfil === "admin" && ficaSemAdmin()) throw new ErroContas("O Lastro precisa de pelo menos um administrador ativo.", 400);
          u.ativo = false;
          u.sessoes = [];
          u.convite = null;
          break;
        case "reativar":
          u.ativo = true;
          break;
        case "perfil": {
          if (!perfilValido(b.perfil)) throw new ErroContas("Perfil inválido.", 400);
          if (u.email === eu) throw new ErroContas("Peça a outro administrador para mudar o seu perfil.", 400);
          if (u.perfil === "admin" && b.perfil !== "admin" && ficaSemAdmin()) {
            throw new ErroContas("O Lastro precisa de pelo menos um administrador ativo.", 400);
          }
          u.perfil = b.perfil;
          break;
        }
        case "encerrar":
          u.sessoes = [];
          break;
        case "cancelar_convite":
          u.convite = null;
          break;
      }
      return { usuario: publico(u, agora), token };
    });
    return Response.json({ usuario: resultado.usuario, link: resultado.token ? linkDe(request, resultado.token) : null });
  } catch (erro) {
    return responderErro(erro);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const s = await admin(request, true);
    if (!s.ok) return s.resposta;
    const email = normalizarEmail(request.nextUrl.searchParams.get("email"));
    await alterarUsuarios((lista) => {
      const i = lista.findIndex((x) => x.email === email);
      if (i < 0) throw new ErroContas("Conta não encontrada.", 404);
      const u = lista[i];
      if (u.email === s.quem.email) throw new ErroContas("Você não pode excluir a sua própria conta.", 400);
      if (u.perfil === "admin" && u.ativo && adminsAtivos(lista).length <= 1) {
        throw new ErroContas("O Lastro precisa de pelo menos um administrador ativo.", 400);
      }
      lista.splice(i, 1);
    });
    return Response.json({ ok: true });
  } catch (erro) {
    return responderErro(erro);
  }
}
