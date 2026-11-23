// Se o login está ligado e quem pode ter conta.
//
// Login = conta própria do Lastro: e-mail + senha + código do authenticator, no mesmo modelo
// do Bate Lastro e do dashboard-lastro (contas criadas por convite de um administrador). Na
// Vercel ele é sempre obrigatório; no computador só liga quando há SESSAO_SEGREDO (a versão
// local continua abrindo direto, como sempre).

export function segredoSessao(): string {
  return process.env.SESSAO_SEGREDO?.trim() ?? "";
}

export function loginObrigatorio(): boolean {
  return !!process.env.VERCEL || !!segredoSessao();
}

/** Problema de configuração que impede o login (o app fica fechado até resolver). */
export function problemaDeConfiguracao(): string | null {
  if (!loginObrigatorio()) return null;
  if (segredoSessao().length < 32) return "SESSAO_SEGREDO não configurado (mínimo de 32 caracteres).";
  return null;
}

/** Chave para criar o primeiro administrador (só vale enquanto não existe nenhuma conta). */
export function chaveInstalacao(): string {
  return process.env.CHAVE_INSTALACAO?.trim() ?? "";
}

function lista(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizarEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Só ganha conta quem é do domínio da Denver (ACESSO_DOMINIOS) ou está na lista ACESSO_EMAILS. */
export function emailPermitido(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const e = normalizarEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
  const emails = lista(env.ACESSO_EMAILS);
  if (emails.includes(e)) return true;
  const dominios = lista(env.ACESSO_DOMINIOS ?? "denvercontabil.com.br");
  return dominios.includes(e.split("@")[1]);
}
