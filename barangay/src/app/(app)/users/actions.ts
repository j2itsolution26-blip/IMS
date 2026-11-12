'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { audit } from '@/lib/audit';
import { formObject, text } from '@/lib/form';
import { hashPassword, passwordProblem } from '@/lib/password';
import { ROLE_LABELS } from '@/lib/permissions';
import { runAction, type ActionResult } from '@/lib/action';

const ROLES = ['CAPTAIN', 'SECRETARY', 'TREASURER', 'KAGAWAD', 'LUPON', 'STAFF'] as const;

const createSchema = z.object({
  fullName: text('Full name', 120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, 'Username: 3–32 letters, numbers, dots, dashes or underscores.'),
  role: z.enum(ROLES),
  password: z.string(),
});

export async function createUser(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const me = await authorize('users.manage');
    const input = createSchema.parse(formObject(fd));
    const problem = passwordProblem(input.password);
    if (problem) return { error: problem };
    const user = await prisma.user.create({
      data: { fullName: input.fullName, username: input.username, role: input.role, passwordHash: await hashPassword(input.password) },
    });
    await audit({ userId: me.id, action: 'user.create', entity: 'User', entityId: user.id, summary: `Created ${ROLE_LABELS[user.role]} account ${user.username}` });
    revalidatePath('/users');
    return { ok: `Account ${user.username} created. Give the password to ${user.fullName} in person.` };
  });
}

const updateSchema = z.object({
  id: text('Account', 40),
  role: z.enum(ROLES),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
  password: z.string().optional().default(''),
});

export async function updateUser(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const me = await authorize('users.manage');
    const input = updateSchema.parse(formObject(fd));
    const target = await prisma.user.findUnique({ where: { id: input.id } });
    if (!target) return { error: 'Account not found.' };
    if (target.id === me.id && (input.role !== 'CAPTAIN' || !input.active))
      return { error: 'You cannot remove your own Punong Barangay access or deactivate yourself.' };
    if (input.password) {
      const problem = passwordProblem(input.password);
      if (problem) return { error: problem };
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          role: input.role,
          active: input.active,
          ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
        },
      });
      // Role, status or password changes end the account's open sessions.
      if (input.password || !input.active || input.role !== target.role) await tx.session.deleteMany({ where: { userId: target.id } });
      const changes = [
        input.role !== target.role && `role → ${ROLE_LABELS[input.role]}`,
        input.active !== target.active && (input.active ? 'reactivated' : 'deactivated'),
        input.password && 'password reset',
      ].filter(Boolean);
      await audit({ userId: me.id, action: 'user.update', entity: 'User', entityId: target.id, summary: `${target.username}: ${changes.join(', ') || 'no changes'}` }, tx);
    });
    revalidatePath('/users');
    return { ok: 'Saved.' };
  });
}
