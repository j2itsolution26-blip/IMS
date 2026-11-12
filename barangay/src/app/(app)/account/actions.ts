'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/password';
import { audit } from '@/lib/audit';
import { createSession } from '@/lib/session';
import type { ActionResult } from '@/lib/action';

export async function changePassword(fd: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { error: 'Your session has ended. Please sign in again.' };
  const current = String(fd.get('current') ?? '');
  const next = String(fd.get('next') ?? '');
  if (next !== String(fd.get('confirm') ?? '')) return { error: 'The new passwords do not match.' };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await verifyPassword(current, user.passwordHash))) return { error: 'Your current password is wrong.' };
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(next) } });
  // Sign out every other device, then start a fresh session here.
  await prisma.session.deleteMany({ where: { userId: me.id } });
  await createSession(me.id);
  await audit({ userId: me.id, action: 'user.password', entity: 'User', entityId: me.id, summary: `${me.username} changed their password` });
  return { ok: 'Password changed. Other devices have been signed out.' };
}
