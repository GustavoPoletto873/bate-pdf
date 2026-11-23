import { quemEsta } from '@/lib/auth/requisicao';

/** E-mail de quem está usando (com login). Na versão local, sem login, devolve null. */
export async function usuarioAtual(): Promise<string | null> {
  return (await quemEsta())?.email ?? null;
}
