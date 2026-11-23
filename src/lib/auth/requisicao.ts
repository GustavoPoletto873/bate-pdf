// Sessão, origem e limite de tentativas. O proxy chama `sessaoValida` em toda página e toda API;
// as rotas que precisam saber quem é (ou exigir administrador) usam `quemEsta` / `exigirAdmin`.
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { loginObrigatorio, segredoSessao } from "./config";
import { abrir, COOKIE_SESSAO, DIAS_SEM_USO, type Sessao } from "./sessao";
import { alterarUsuarios, aoMudarContas, buscarUsuario, podeEntrar, type Perfil } from "./usuarios";

export interface Quem {
  email: string;
  nome: string;
  perfil: Perfil;
}

/** De quanto em quanto tempo o "último uso" da sessão é regravado (conta e cookie). */
export const RENOVAR_MS = 60 * 60_000;

// Cache curto das sessões já conferidas: sem ele, cada pedido do app seria uma ida ao banco
// (no Turso, à rede). Qualquer mudança nas contas desta instância limpa o cache; em outra
// instância da Vercel, desativar/encerrar sessões vale em até CACHE_MS.
const CACHE_MS = 30_000;
const g = globalThis as unknown as { __lastroSessoes?: Map<string, { quem: Quem; ate: number }> };
const cache = (g.__lastroSessoes ??= new Map());
aoMudarContas(() => cache.clear());

/** A sessão do cookie ainda vale na conta? (conta ativa, sessão registrada e usada nos últimos 30 dias) */
export async function sessaoValida(s: Sessao, agora = Date.now()): Promise<Quem | null> {
  const chave = `${s.email}|${s.sid}`;
  const c = cache.get(chave);
  if (c && c.ate > agora) return c.quem;
  const u = await buscarUsuario(s.email);
  const guardada = u?.sessoes.find((x) => x.id === s.sid);
  if (!u || !podeEntrar(u) || !guardada || guardada.visto + DIAS_SEM_USO * 86_400_000 <= agora) {
    cache.delete(chave);
    return null;
  }
  const quem: Quem = { email: u.email, nome: u.nome, perfil: u.perfil };
  if (cache.size > 500) cache.clear();
  cache.set(chave, { quem, ate: agora + CACHE_MS });
  return quem;
}

/** Regrava o último uso da sessão na conta (o cookie novo é posto pelo proxy). */
export async function renovarSessao(s: Sessao, agora = Date.now()): Promise<void> {
  await alterarUsuarios((lista) => {
    const guardada = lista.find((x) => x.email === s.email)?.sessoes.find((x) => x.id === s.sid);
    if (guardada) guardada.visto = agora;
  });
}

/** Quem está usando o app. null sem login (versão local) ou sem sessão válida. */
export async function quemEsta(): Promise<Quem | null> {
  if (!loginObrigatorio()) return null;
  const s = abrir((await cookies()).get(COOKIE_SESSAO)?.value, segredoSessao());
  return s ? sessaoValida(s) : null;
}

/** Para as rotas de administração das contas: resposta de erro, ou quem é o administrador. */
export async function exigirAdmin(): Promise<{ ok: true; quem: Quem } | { ok: false; resposta: Response }> {
  if (!loginObrigatorio()) {
    return { ok: false, resposta: Response.json({ erro: "O login está desligado neste computador: não há contas para administrar." }, { status: 400 }) };
  }
  const quem = await quemEsta();
  if (!quem) return { ok: false, resposta: Response.json({ entrar: true, erro: "Entre no Lastro de novo." }, { status: 401 }) };
  if (quem.perfil !== "admin") return { ok: false, resposta: Response.json({ erro: "Só administradores podem fazer isso." }, { status: 403 }) };
  return { ok: true, quem };
}

export function cookieSeguro(request: NextRequest): boolean {
  return request.nextUrl.protocol === "https:";
}

/** Pedidos que mudam algo só valem vindos do próprio app. */
export function origemRecusada(request: NextRequest): Response | null {
  const origem = request.headers.get("origin");
  if (origem && origem !== request.nextUrl.origin) {
    return Response.json({ erro: "Pedido de outra origem recusado." }, { status: 403 });
  }
  return null;
}

export function ipDe(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "local";
}

// ---------------------------------------------------------------- limite de tentativas

function muitas(janelaS: number): Response {
  return Response.json(
    { erro: "Muitas tentativas. Espere um pouco e tente de novo.", esperar: janelaS },
    { status: 429, headers: { "Retry-After": String(janelaS) } },
  );
}

async function contagem(chave: string, janelaS: number, agora = Date.now()): Promise<number> {
  const r = await (await db()).prepare("SELECT COUNT(*) n FROM acesso_tentativas WHERE chave = ? AND em > ?").get<{ n: number }>(chave, agora - janelaS * 1000);
  return Number(r?.n ?? 0);
}

/** Registra uma tentativa (e, de vez em quando, apaga as de mais de um dia). */
async function registrar(chave: string, agora = Date.now()): Promise<void> {
  const c = await db();
  const comandos: { sql: string; args: (string | number)[] }[] = [{ sql: "INSERT INTO acesso_tentativas (chave, em) VALUES (?, ?)", args: [chave, agora] }];
  if (Math.random() < 0.02) comandos.push({ sql: "DELETE FROM acesso_tentativas WHERE em < ?", args: [agora - 86_400_000] });
  await c.lote(comandos);
}

/** Já passou do limite de falhas registradas (sem contar esta tentativa)? */
export async function bloqueado(chave: string, maximo: number, janelaS: number): Promise<Response | null> {
  return (await contagem(chave, janelaS)) < maximo ? null : muitas(janelaS);
}

/** Registra uma falha (para `bloqueado`). */
export async function registrarFalha(chave: string): Promise<void> {
  await registrar(chave);
}

/** Limite de tentativas (como o rate limit do login do Bate Lastro): conta esta e confere. */
export async function limitar(regras: { chave: string; maximo: number; janelaS: number }[]): Promise<Response | null> {
  for (const r of regras) {
    await registrar(r.chave);
    if ((await contagem(r.chave, r.janelaS)) > r.maximo) return muitas(r.janelaS);
  }
  return null;
}

/** Erro inesperado numa rota de acesso: registra no terminal e devolve uma mensagem genérica. */
export function respostaDeErro(erro: unknown, onde: string): Response {
  console.error(`[${onde}]`, erro);
  return Response.json({ erro: "O Lastro não conseguiu concluir agora. Tente de novo em instantes." }, { status: 500 });
}
