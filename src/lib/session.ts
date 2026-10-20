import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { APIError } from 'better-auth/api';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { isSafeReturnPath } from '@/lib/safe-path';

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  email: string;
  image: string | null;
  isActive: boolean;
  role: { id: string; name: string; slug: string };
  permissions: Set<PermissionKey>;
  /** The Better Auth session this request is running under. */
  sessionId: string;
  /** True while the POS lock screen is up for this session. */
  isLocked: boolean;
  /** Whether the lock screen can offer PIN entry (the hash never leaves the server). */
  hasPin: boolean;
}

/** Message for any action attempted while the screen is locked. */
export const LOCKED_MESSAGE = 'The screen is locked. Unlock it to continue.';

/**
 * Resolves the signed-in user and their effective permissions.
 *
 * Wrapped in React `cache` so a page that calls this from the layout, the
 * header, and three server components still issues one query per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;

  try {
    // Read from the database every time, never from a cached cookie copy, so
    // a revoked session stops working on the very next request.
    session = await auth.api.getSession({
      headers: await headers(),
      query: { disableCookieCache: true },
    });
  } catch (error) {
    // A cookie that cannot be verified (wrong secret, tampered, expired)
    // already comes back as `null` above — Better Auth only throws when it
    // could not *check* the session, typically because the database was
    // briefly unreachable. Treating that as "signed out" used to send the
    // cashier through /api/session/reset, which deleted a perfectly good
    // cookie over a network blip.
    //
    // So only an explicit authentication refusal counts as signed out.
    // Anything else propagates to the error boundary, which offers a retry
    // and leaves the cookie — and the session — intact.
    if (error instanceof APIError && (error.statusCode === 401 || error.statusCode === 403)) {
      return null;
    }
    console.error('[auth] session could not be checked; keeping the cookie', error);
    throw error;
  }

  if (!session?.user?.id) return null;

  const [user, sessionRow] = await Promise.all([
    prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      image: true,
      isActive: true,
      posPinHash: true,
      role: {
        select: {
          id: true,
          name: true,
          slug: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
    }),
    prisma.session.findUnique({
      where: { id: session.session.id },
      select: { lockedAt: true },
    }),
  ]);

  // A deactivated account keeps a valid cookie until it expires, so the check
  // has to happen on every request, not just at sign-in.
  if (!user || !user.isActive || !sessionRow) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    image: user.image,
    isActive: user.isActive,
    role: { id: user.role.id, name: user.role.name, slug: user.role.slug },
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.key as PermissionKey)),
    sessionId: session.session.id,
    isLocked: sessionRow.lockedAt !== null,
    hasPin: user.posPinHash !== null,
  };
});

export function userCan(user: CurrentUser | null, permission: PermissionKey): boolean {
  if (!user) return false;
  return user.permissions.has(permission);
}

export function userCanAny(user: CurrentUser | null, permissions: PermissionKey[]): boolean {
  return permissions.some((p) => userCan(user, p));
}

/**
 * For pages: sends the visitor to sign-in instead of throwing.
 *
 * Routes through `/api/session/reset` rather than straight to `/sign-in`
 * because reaching here means a session cookie was *present* but did not
 * resolve to a usable account — stale signature, deleted user, or a
 * deactivated one. Middleware only tests whether the cookie exists, so
 * redirecting to `/sign-in` while that cookie is still set would bounce
 * straight back to the dashboard and loop. The reset route clears it first.
 * Server components cannot write cookies, which is why this needs a handler.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/api/session/reset');
  // A locked session is still signed in, but no page renders for it. A screen
  // locked mid-shift is covered client-side without navigating (so the POS
  // cart survives); this catches a refresh or a newly opened page.
  if (user.isLocked) {
    const path = (await headers()).get('x-pathname');
    redirect(isSafeReturnPath(path) ? `/locked?next=${encodeURIComponent(path)}` : '/locked');
  }
  return user;
}


/** For pages: 403s through the nearest error boundary. */
export async function requirePermission(permission: PermissionKey): Promise<CurrentUser> {
  const user = await requireUser();
  if (!userCan(user, permission)) {
    throw new ForbiddenError(`You do not have permission to ${permission.replace('.', ' ')}.`);
  }
  return user;
}

/** For server actions and route handlers: throws, so the caller returns a typed failure. */
export async function authorize(permission: PermissionKey): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (user.isLocked) throw new ForbiddenError(LOCKED_MESSAGE);
  if (!user.permissions.has(permission)) {
    throw new ForbiddenError(`You do not have permission to ${permission.replace('.', ' ')}.`);
  }
  return user;
}

/**
 * For self-service server actions that need a signed-in, unlocked user but no
 * particular permission (own profile, own PIN).
 */
export async function authenticate(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (user.isLocked) throw new ForbiddenError(LOCKED_MESSAGE);
  return user;
}

/** Client IP + UA for the audit trail. */
export async function getRequestContext(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent'),
  };
}
