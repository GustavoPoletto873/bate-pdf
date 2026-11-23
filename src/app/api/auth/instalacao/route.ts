import { connection, type NextRequest } from "next/server";

import { chaveInstalacao, emailPermitido, loginObrigatorio, normalizarEmail, problemaDeConfiguracao } from "@/lib/auth/config";
import { iguais } from "@/lib/auth/cripto";
import { ipDe, limitar, origemRecusada, respostaDeErro } from "@/lib/auth/requisicao";
import { alterarUsuarios, ErroContas, lerUsuarios, novoConvite } from "@/lib/auth/usuarios";

const TAMANHO_MIN_CHAVE = 16;

/** O Lastro ainda não tem nenhuma conta? (a tela de entrar mostra a configuração inicial) */
export async function GET() {
  await connection();
  if (!loginObrigatorio() || problemaDeConfiguracao()) return Response.json({ precisa: false });
  try {
    const vazio = (await lerUsuarios()).length === 0;
    return Response.json({ precisa: vazio, chaveConfigurada: chaveInstalacao().length >= TAMANHO_MIN_CHAVE });
  } catch (erro) {
    return respostaDeErro(erro, "auth/instalacao");
  }
}

/**
 * Cria o primeiro administrador. Só funciona enquanto não existe nenhuma conta e com a
 * CHAVE_INSTALACAO (variável que só quem cuida da Vercel conhece). Devolve o token do
 * convite: a tela segue direto para criar a senha e configurar o authenticator.
 */
export async function POST(request: NextRequest) {
  const recusado = origemRecusada(request);
  if (recusado) return recusado;
  if (!loginObrigatorio()) return Response.json({ erro: "O login está desligado neste computador." }, { status: 400 });
  const problema = problemaDeConfiguracao();
  if (problema) return Response.json({ erro: `O login do Lastro não está configurado: ${problema}` }, { status: 503 });

  const b = (await request.json().catch(() => ({}))) as { chave?: unknown; email?: unknown; nome?: unknown };
  const chave = typeof b.chave === "string" ? b.chave.trim() : "";
  const email = normalizarEmail(typeof b.email === "string" ? b.email : "");
  const nome = typeof b.nome === "string" ? b.nome.trim().slice(0, 80) : "";

  try {
    const limite = await limitar([{ chave: `instalacao:ip:${ipDe(request)}`, maximo: 5, janelaS: 60 }]);
    if (limite) return limite;

    const esperada = chaveInstalacao();
    if (esperada.length < TAMANHO_MIN_CHAVE) {
      return Response.json({ erro: `Configure a variável CHAVE_INSTALACAO (mínimo de ${TAMANHO_MIN_CHAVE} caracteres) no servidor.` }, { status: 503 });
    }
    if (!iguais(chave, esperada)) return Response.json({ erro: "Chave de instalação incorreta." }, { status: 401 });
    if (!emailPermitido(email)) return Response.json({ erro: "Use um e-mail da Denver (ou um dos liberados em ACESSO_EMAILS)." }, { status: 400 });
    if (nome.length < 2) return Response.json({ erro: "Informe seu nome." }, { status: 400 });

    const token = await alterarUsuarios((lista) => {
      if (lista.length) throw new ErroContas("O Lastro já tem administrador. Entre com a sua conta.", 409);
      const agora = Date.now();
      const { token, convite } = novoConvite("cadastro", "instalação", agora);
      lista.push({
        email,
        nome,
        perfil: "admin",
        ativo: true,
        senha: null,
        totp: null,
        ultimoPasso: -1,
        convite,
        sessoes: [],
        criadoEm: agora,
        criadoPor: "instalação",
        ultimoAcesso: null,
      });
      return token;
    });
    return Response.json({ token });
  } catch (erro) {
    if (erro instanceof ErroContas) return Response.json({ erro: erro.message }, { status: erro.status });
    return respostaDeErro(erro, "auth/instalacao");
  }
}
