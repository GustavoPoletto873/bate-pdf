import { auth, loginAtivo } from '@/auth';

/** E-mail de quem está usando (versão na nuvem). Na versão local não há login: devolve null. */
export async function usuarioAtual(): Promise<string | null> {
  if (!loginAtivo()) return null;
  const sessao = await auth();
  return sessao?.user?.email ?? null;
}
