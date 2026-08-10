import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isActive: boolean;
  role: { id: string; name: string; slug: string };
  permissions: Set<PermissionKey>;
}

/**
 * Resolves the signed-in user and their effective permissions.
 *
 * Wrapped in React `cache` so a page that calls this from the layout, the
 * header, and three server components still issues one query per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;

  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    // A cookie that cannot be verified is an unauthenticated request, not a
    // server fault. The usual cause is BETTER_AUTH_SECRET changing (or being
    // set for the first time) while browsers still hold cookies signed under
    // the previous value — every one of those sessions becomes unverifiable at
    // once. Letting this propagate turns a routine "sign in again" into a 500
    // on every authenticated page.
    //
    // The error is logged rather than swallowed: it is a real signal when it
    // appears for any other reason.
    console.error('[auth] session could not be verified; treating as signed out', error);
    return null;
  }

  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      isActive: true,
      role: {
        select: {
          id: true,
          name: true,
          slug: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });

  // A deactivated account keeps a valid cookie until it expires, so the check
  // has to happen on every request, not just at sign-in.
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    isActive: user.isActive,
    role: { id: user.role.id, name: user.role.name, slug: user.role.slug },
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.key as PermissionKey)),
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
  if (!user.permissions.has(permission)) {
    throw new ForbiddenError(`You do not have permission to ${permission.replace('.', ' ')}.`);
  }
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
