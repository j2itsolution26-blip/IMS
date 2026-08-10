import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge gate.
 *
 * This only checks whether a session cookie is *present* — it deliberately does
 * not decide what the user may do, and it does not verify the cookie. Presence
 * is cheap to test at the edge but proves nothing, so real authentication and
 * authorisation happen in `getCurrentUser`/`authorize`, which read the session
 * from the database on every page and every action. Treat this purely as a
 * redirect convenience.
 *
 * The cookie name is matched directly rather than via `better-auth/cookies`,
 * which pulls `jose` into the Edge bundle and warns about unsupported Node
 * APIs. Reading a cookie name needs none of that.
 */

// Better Auth prefixes the cookie with `__Secure-` when serving over HTTPS.
const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

// `/api/health` must stay reachable without a session: its whole purpose is
// diagnosing a deployment where authentication is broken, and gating it behind
// the thing it diagnoses would make it useless. It returns no secret values.
const PUBLIC_PATHS = ['/sign-in', '/sign-up', '/api/auth', '/api/health'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value));
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!hasSession && !isPublic) {
    const url = new URL('/sign-in', request.url);
    // Preserve where they were heading so sign-in can send them back.
    if (pathname !== '/') url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (hasSession && (pathname === '/sign-in' || pathname === '/sign-up')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)'],
};
