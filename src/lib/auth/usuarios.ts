// Contas do Lastro, no mesmo modelo do Bate Lastro e do dashboard-lastro:
//   - um administrador convida (link de uso único, 48 h);
//   - quem recebe cria a senha e configura o authenticator (obrigatório);
//   - entrar = e-mail + senha → código do authenticator.
// Ficam na tabela contas (uma linha por pessoa, dados em JSON), no banco do app (arquivo local
// ou Turso). Toda alteração passa por alterarUsuarios, numa transação.
import { db, transacao, type Banco } from "@/lib/db";
import { normalizarEmail } from "./config";
import { hashToken, tokenAleatorio } from "./cripto";

export type Perfil = "admin" | "usuario";

export interface Convite {
  hash: string; // sha256 do token (o token em si só aparece no link)
  expira: number;
  tipo: "cadastro" | "redefinir";
  criadoPor: string;
  criadoEm: number;
  /** Senha e segredo escolhidos no meio do convite, à espera do primeiro código. */
  pendente?: { senha: string; totp: string } | null;
}

export interface SessaoGuardada {
  id: string;
  criada: number;
  visto: number;
  nav?: string;
}

export interface Usuario {
  email: string;
  nome: string;
  perfil: Perfil;
  ativo: boolean;
  senha: string | null;
  totp: string | null; // segredo do authenticator, cifrado
  ultimoPasso: number; // último código aceito (não aceita o mesmo de novo)
  ultimoDesafio?: string; // último desafio de login usado (cada um vale uma vez)
  convite: Convite | null;
  sessoes: SessaoGuardada[];
  criadoEm: number;
  criadoPor: string;
  ultimoAcesso: number | null;
}

export type Situacao = "ativo" | "convite" | "convite_vencido" | "desativado";

export interface UsuarioPublico {
  email: string;
  nome: string;
  perfil: Perfil;
  situacao: Situacao;
  conviteTipo: Convite["tipo"] | null;
  conviteExpira: string | null;
  ultimoAcesso: string | null;
  sessoes: number;
  criadoEm: string;
  criadoPor: string;
}

export const HORAS_CONVITE = 48; // igual ao INVITE_TTL_HOURS do Bate Lastro
const MAX_SESSOES = 10;

export class ErroContas extends Error {
  constructor(
    mensagem: string,
    readonly status = 400,
  ) {
    super(mensagem);
  }
}

// ---------------------------------------------------------------- leitura e gravação

async function carregar(c: Banco): Promise<Usuario[]> {
  const linhas = await c.prepare("SELECT dados FROM contas ORDER BY email").all<{ dados: string }>();
  return linhas.map((l) => JSON.parse(l.dados) as Usuario);
}

export async function lerUsuarios(): Promise<Usuario[]> {
  return carregar(await db());
}

export async function buscarUsuario(email: string): Promise<Usuario | null> {
  const e = normalizarEmail(email);
  const l = await (await db()).prepare("SELECT dados FROM contas WHERE email = ?").get<{ dados: string }>(e);
  return l ? (JSON.parse(l.dados) as Usuario) : null;
}

/** Avisados a cada mudança nas contas (o cache de sessões do proxy se limpa). */
const ouvintes = new Set<() => void>();
export function aoMudarContas(fn: () => void): void {
  ouvintes.add(fn);
}

/** Lê as contas, deixa `fn` alterar a lista e grava o que mudou, tudo numa transação. */
export async function alterarUsuarios<T>(fn: (lista: Usuario[]) => T | Promise<T>): Promise<T> {
  const r = await transacao(async (tx) => {
    const lista = await carregar(tx);
    const antes = new Map(lista.map((u) => [u.email, JSON.stringify(u)]));
    const resultado = await fn(lista);
    const comandos: { sql: string; args: string[] }[] = [];
    const ficam = new Set<string>();
    for (const u of lista) {
      ficam.add(u.email);
      const json = JSON.stringify(u);
      if (antes.get(u.email) !== json) comandos.push({ sql: "INSERT OR REPLACE INTO contas (email, dados) VALUES (?, ?)", args: [u.email, json] });
    }
    for (const email of antes.keys()) if (!ficam.has(email)) comandos.push({ sql: "DELETE FROM contas WHERE email = ?", args: [email] });
    if (comandos.length) await tx.lote(comandos);
    return resultado;
  });
  for (const f of ouvintes) f();
  return r;
}

// ---------------------------------------------------------------- regras

export function situacao(u: Usuario, agora = Date.now()): Situacao {
  if (!u.ativo) return "desativado";
  if (u.senha && u.totp && !(u.convite && u.convite.tipo === "cadastro")) return "ativo";
  return u.convite && u.convite.expira > agora ? "convite" : "convite_vencido";
}

/** Pode entrar com senha + código? (cadastro completo e conta ativa) */
export function podeEntrar(u: Usuario | null): u is Usuario {
  return !!u && u.ativo && !!u.senha && !!u.totp;
}

export function publico(u: Usuario, agora = Date.now()): UsuarioPublico {
  return {
    email: u.email,
    nome: u.nome,
    perfil: u.perfil,
    situacao: situacao(u, agora),
    conviteTipo: u.convite?.tipo ?? null,
    conviteExpira: u.convite ? new Date(u.convite.expira).toISOString() : null,
    ultimoAcesso: u.ultimoAcesso ? new Date(u.ultimoAcesso).toISOString() : null,
    sessoes: u.sessoes.length,
    criadoEm: new Date(u.criadoEm).toISOString(),
    criadoPor: u.criadoPor,
  };
}

export function adminsAtivos(lista: Usuario[]): Usuario[] {
  return lista.filter((u) => u.perfil === "admin" && u.ativo);
}

/** Gera um convite novo. O token volta só aqui (para o link); guardamos o hash. */
export function novoConvite(tipo: Convite["tipo"], por: string, agora = Date.now()): { token: string; convite: Convite } {
  const token = tokenAleatorio(32);
  return {
    token,
    convite: { hash: hashToken(token), expira: agora + HORAS_CONVITE * 3_600_000, tipo, criadoPor: por, criadoEm: agora, pendente: null },
  };
}

export function acharPorConvite(lista: Usuario[], token: string, agora = Date.now()): Usuario | null {
  if (!token || token.length < 20) return null;
  const h = hashToken(token);
  const u = lista.find((x) => x.convite?.hash === h);
  if (!u || !u.convite || u.convite.expira <= agora || !u.ativo) return null;
  return u;
}

export function abrirSessaoNaConta(u: Usuario, nav: string | undefined, agora = Date.now()): string {
  const id = tokenAleatorio(18);
  u.sessoes = [...u.sessoes.filter((s) => s.visto + 30 * 86_400_000 > agora), { id, criada: agora, visto: agora, nav: nav?.slice(0, 120) }]
    .sort((a, b) => b.visto - a.visto)
    .slice(0, MAX_SESSOES);
  u.ultimoAcesso = agora;
  return id;
}
