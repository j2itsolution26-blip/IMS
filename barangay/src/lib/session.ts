import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@prisma/client';
import { prisma } from './prisma';
import { sessionToken, sha256 } from './codes';
import { can, type Permission } from './permissions';

export const SESSION_COOKIE = 'brgy_session';
const SESSION_DAYS = 7;

export type CurrentUser = { id: string; username: string; fullName: string; role: Role };

export async function createSession(userId: string): Promise<void> {
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const { id, username, fullName, role } = session.user;
  return { id, username, fullName, role };
}

/** For pages: signed-out users go to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** For pages: a missing permission shows the "no access" page. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect('/no-access');
  return user;
}

export class ActionError extends Error {}

/** For server actions: throws instead of redirecting. */
export async function authorize(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError('Your session has ended. Please sign in again.');
  if (!can(user.role, permission)) throw new ActionError('You do not have permission to do this.');
  return user;
}
