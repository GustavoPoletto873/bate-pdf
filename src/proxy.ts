import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { auth, emailPermitido, loginAtivo } from '@/auth';

/**
 * Na nuvem, toda página e toda API exigem login com o Google da empresa. Na versão local
 * (sem AUTH_GOOGLE_ID) passa direto.
 */
const comLogin = auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/api/auth') || pathname === '/entrar') return NextResponse.next();
  if (emailPermitido(req.auth?.user?.email)) return NextResponse.next();
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ erro: 'Sessão expirada. Entre de novo com o Google da empresa.' }, { status: 401 });
  }
  const entrar = new URL('/entrar', req.url);
  entrar.searchParams.set('voltar', pathname + search);
  return NextResponse.redirect(entrar);
});

export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  if (!loginAtivo()) return NextResponse.next();
  return (comLogin as unknown as (r: NextRequest, e: NextFetchEvent) => Promise<Response>)(req, ev);
}

export const config = {
  // Tudo, menos arquivos estáticos do Next e ícones.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?|ico)$).*)'],
};
