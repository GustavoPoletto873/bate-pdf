import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Login da versão na nuvem: Google da empresa, só e-mails do domínio (LASTRO_DOMINIO, padrão
 * denvercontabil.com.br). Na versão local (sem AUTH_GOOGLE_ID) não há login: quem usa é quem
 * está na máquina.
 *
 * Variáveis (na Vercel): AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET e, se preciso, AUTH_URL.
 */

export const DOMINIO = (process.env.LASTRO_DOMINIO || 'denvercontabil.com.br').trim().toLowerCase();

export function loginAtivo(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID?.trim());
}

export function emailPermitido(email: string | null | undefined): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  return e.endsWith('@' + DOMINIO) && e.length > DOMINIO.length + 1;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // hd: o Google já mostra só as contas do domínio; a conferência que vale é a do signIn abaixo.
  providers: [Google({ authorization: { params: { hd: DOMINIO, prompt: 'select_account' } } })],
  pages: { signIn: '/entrar', error: '/entrar' },
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  trustHost: true,
  callbacks: {
    signIn({ profile }) {
      return profile?.email_verified === true && emailPermitido(profile.email);
    },
  },
});
