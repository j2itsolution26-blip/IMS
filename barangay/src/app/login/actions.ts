'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { createSession, destroySession } from '@/lib/session';
import { audit } from '@/lib/audit';
import type { ActionResult } from '@/lib/action';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
// Verifies against this when the username does not exist, so a wrong
// username takes as long as a wrong password.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

export async function login(fd: FormData): Promise<ActionResult> {
  const username = String(fd.get('username') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  if (!username || !password) return { error: 'Enter your username and password.' };

  const failures = await prisma.loginAttempt.count({
    where: { username, success: false, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
  });
  if (failures >= MAX_FAILURES) {
    return { error: 'Too many failed attempts. Wait 15 minutes, or ask the Punong Barangay to reset your password.' };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  const ok = Boolean(user && user.active && valid);
  await prisma.loginAttempt.create({ data: { username, success: ok } });

  if (!ok || !user) {
    await audit({ userId: user?.id ?? null, action: 'login.failed', entity: 'User', entityId: user?.id, summary: `Failed sign-in for "${username}"` });
    return { error: 'Wrong username or password.' };
  }

  await createSession(user.id);
  await audit({ userId: user.id, action: 'login', entity: 'User', entityId: user.id, summary: `${user.fullName} signed in` });
  redirect('/');
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
