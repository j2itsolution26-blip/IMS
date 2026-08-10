import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Clears an unusable session cookie and sends the visitor to sign in.
 *
 * Needed because a server component cannot write cookies. When a cookie is
 * present but does not resolve to a usable account — most often because
 * BETTER_AUTH_SECRET changed and every previously issued cookie became
 * unverifiable — the page can only redirect, and redirecting to `/sign-in`
 * while the cookie is still set makes the edge middleware (which tests only
 * for presence) bounce the request back to the dashboard, looping forever.
 *
 * Expiring the cookie here breaks that cycle and gets the user to a working
 * sign-in form in one hop.
 */

// Both the plain and the `__Secure-` prefixed forms, plus the cookie-cache
// entries Better Auth writes alongside them.
const SESSION_COOKIES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  'better-auth.session_data',
  '__Secure-better-auth.session_data',
];

export async function GET(request: NextRequest) {
  const target = new URL('/sign-in', request.url);
  target.searchParams.set('reason', 'session-expired');

  // Preserve where they were heading so sign-in can send them back.
  const next = request.nextUrl.searchParams.get('next');
  if (next?.startsWith('/')) target.searchParams.set('next', next);

  const response = NextResponse.redirect(target);

  for (const name of SESSION_COOKIES) {
    // Setting an already-expired cookie is what actually removes it from the
    // browser; `delete` alone does not always emit a header the client honours
    // when the cookie was originally set with different attributes.
    response.cookies.set(name, '', {
      path: '/',
      expires: new Date(0),
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
    });
  }

  return response;
}
