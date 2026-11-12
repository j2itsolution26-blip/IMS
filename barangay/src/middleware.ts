import { NextResponse, type NextRequest } from 'next/server';

// A cheap first gate: no session cookie → sign-in page. Every page and action
// still checks the session and the role against the database.
const PUBLIC = ['/login', '/setup', '/verify'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get('brgy_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
