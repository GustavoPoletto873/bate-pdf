import { NextResponse, type NextRequest } from 'next/server';
import { loginObrigatorio, problemaDeConfiguracao, segredoSessao } from '@/lib/auth/config';
import { cookieSeguro, RENOVAR_MS, renovarSessao, sessaoValida } from '@/lib/auth/requisicao';
import { abrir, COOKIE_SESSAO, opcoesCookie, selar } from '@/lib/auth/sessao';

/**
 * Com o login ligado (sempre na Vercel; no computador só com SESSAO_SEGREDO), toda página e toda
 * API exigem uma sessão válida: cookie cifrado + sessão registrada numa conta ativa. Ficam abertas
 * só as telas de acesso (/entrar, /convite) e as rotas /api/auth/*. Sem login, passa direto.
 */
const ABERTAS = ['/entrar', '/convite', '/api/auth/'];

export async function proxy(request: NextRequest) {
  if (!loginObrigatorio()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (ABERTAS.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'))) return NextResponse.next();
  const api = pathname.startsWith('/api/');

  const problema = problemaDeConfiguracao();
  if (problema) {
    if (api) return NextResponse.json({ erro: `O login do Lastro não está configurado: ${problema}` }, { status: 503 });
    return NextResponse.redirect(new URL('/entrar?erro=config', request.url));
  }

  const s = abrir(request.cookies.get(COOKIE_SESSAO)?.value, segredoSessao());
  const quem = s ? await sessaoValida(s) : null;
  if (!s || !quem) {
    if (api) return NextResponse.json({ entrar: true, erro: 'Sua sessão terminou. Entre no Lastro de novo.' }, { status: 401 });
    const destino = new URL('/entrar', request.url);
    destino.searchParams.set('voltar', pathname + search);
    return NextResponse.redirect(destino);
  }

  const r = NextResponse.next();
  const agora = Date.now();
  if (agora - s.visto > RENOVAR_MS) {
    await renovarSessao(s, agora).catch(() => null);
    r.cookies.set(COOKIE_SESSAO, selar({ ...s, visto: agora }, segredoSessao()), opcoesCookie(cookieSeguro(request)));
  }
  return r;
}

export const config = {
  // Tudo, menos arquivos estáticos do Next e ícones (a tela de entrar também precisa deles).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?|ico)$).*)'],
};
