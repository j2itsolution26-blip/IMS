'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { APIError } from 'better-auth/api';
import { auth } from '@/lib/auth';
import { platformPrisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { runAsProvisioning } from '@/lib/provisioning-context';
import { recordPlatformAudit } from '@/server/services/audit-service';
import { OWNER_ROLE_SLUG, SYSTEM_ADMIN_ROLE_SLUG } from '@/lib/permissions';
import { normalizeUsername, usernameProblem } from '@/lib/username';

/**
 * Platform administration.
 *
 * Every action re-checks `platform.manage` on the server and writes an audit
 * entry naming the actor, the target and the outcome. Hiding the navigation is
 * not what keeps these safe.
 */

const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a number.')
  .regex(/[^A-Za-z0-9]/, 'Include a special character.');

const createOwnerSchema = z.object({
  name: z.string().trim().min(2, 'Enter a full name.').max(80),
  username: z
    .string()
    .transform(normalizeUsername)
    .superRefine((value, ctx) => {
      const problem = usernameProblem(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: passwordSchema,
  phone: z.string().trim().max(40).optional(),
});

/**
 * Creates the store's owner account.
 *
 * This store has exactly one owner, so the action refuses when one already
 * exists rather than quietly minting a second. Recovery — a forgotten
 * password, a locked-out owner — goes through reset and reactivate below.
 */
export async function createOwnerAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const admin = await authorize('platform.manage');
    const values = parseInput(createOwnerSchema, input);

    // Until stores can be created from the platform screens, the owner is
    // created for the store that does not have one yet.
    const store = await platformPrisma.store.findFirst({
      where: { ownerId: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!store) {
      throw new ConflictError(
        'Every store already has an owner. Reset their password or reactivate them instead.',
      );
    }
    const role = await platformPrisma.role.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: OWNER_ROLE_SLUG } },
      select: { id: true },
    });
    if (!role) throw new ConflictError('The Owner role is missing. Run the bootstrap script.');

    const duplicate = await platformPrisma.user.findUnique({
      where: { email: values.email },
      select: { id: true },
    });
    if (duplicate) {
      throw new ValidationError('That email address already has an account.', {
        email: ['This email is already registered.'],
      });
    }

    const usernameHolder = await platformPrisma.user.findUnique({
      where: { username: values.username },
      select: { id: true },
    });
    if (usernameHolder) {
      throw new ValidationError('That username is already taken.', {
        username: ['This username is already in use.'],
      });
    }

    // Better Auth owns hashing, so the account is created through it rather
    // than written to the table directly. No session is opened — the admin's
    // own cookie must survive this call.
    let created: Awaited<ReturnType<typeof auth.api.signUpEmail>>;
    try {
      created = await runAsProvisioning({ storeId: store.id, roleId: role.id }, async () =>
        auth.api.signUpEmail({
          body: {
            name: values.name,
            email: values.email,
            password: values.password,
            username: values.username,
          },
        }),
      );
    } catch (error) {
      if (error instanceof APIError) {
        const message = (error.body as { message?: string } | undefined)?.message ?? error.message;
        if (/username/i.test(message)) {
          throw new ValidationError(message, { username: [message] });
        }
        throw /exist/i.test(message)
          ? new ValidationError('That email address already has an account.', {
              email: ['This email is already registered.'],
            })
          : new ValidationError(message || 'The account could not be created.');
      }
      throw error;
    }

    const userId = created?.user?.id;
    if (!userId) throw new ConflictError('The account could not be created.');

    const row = await platformPrisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!row) throw new ConflictError('The account could not be created.');

    if (values.phone) {
      await platformPrisma.user.update({ where: { id: userId }, data: { phone: values.phone } });
    }

    await recordPlatformAudit({
      action: 'CREATE',
      entity: 'User',
      entityId: userId,
      summary: `Created owner account @${values.username} (${values.email})`,
      userId: admin.id,
    });

    revalidatePath('/system-admin');
    revalidatePath('/system-admin/owners');
    return { id: userId };
  });
}

/** Suspends or restores an owner's access without touching their store's records. */
export async function setOwnerActive(id: string, isActive: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    const admin = await authorize('platform.manage');

    const target = await platformPrisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, isActive: true, role: { select: { slug: true } } },
    });
    if (!target) throw new NotFoundError('Account');

    // An administrator manages owners, not other administrators — removing
    // that restriction would let one admin lock every other one out.
    if (target.role.slug !== OWNER_ROLE_SLUG) {
      throw new ConflictError('Only owner accounts can be changed here.');
    }
    if (target.isActive === isActive) return;

    await platformPrisma.user.update({ where: { id }, data: { isActive } });

    // Sessions are resolved against `isActive` on every request, so an existing
    // one stops working immediately; clearing the rows makes that explicit and
    // frees the records.
    if (!isActive) {
      await platformPrisma.session.deleteMany({ where: { userId: id } });
    }

    await recordPlatformAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      summary: `${isActive ? 'Reactivated' : 'Deactivated'} owner account ${target.email}`,
      userId: admin.id,
    });

    revalidatePath('/system-admin');
    revalidatePath('/system-admin/owners');
  });
}

const resetSchema = z.object({ password: passwordSchema });

/** Sets a new password for an owner who has lost access to their account. */
export async function resetOwnerPassword(id: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const admin = await authorize('platform.manage');
    const values = parseInput(resetSchema, input);

    const target = await platformPrisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: { select: { slug: true } } },
    });
    if (!target) throw new NotFoundError('Account');
    if (target.role.slug !== OWNER_ROLE_SLUG) {
      throw new ConflictError('Only owner accounts can be reset here.');
    }

    // Hashing goes through Better Auth's own context so the stored hash is
    // produced by exactly the code path sign-in verifies against.
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(values.password);
    await ctx.internalAdapter.updatePassword(id, hash);

    // The old password is gone, so sessions opened with it should be too.
    await platformPrisma.session.deleteMany({ where: { userId: id } });

    await recordPlatformAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      // The new password is never written to the trail.
      summary: `Reset password for owner account ${target.email}`,
      userId: admin.id,
    });

    revalidatePath('/system-admin/owners');
  });
}

/** Guard used by the admin screens, kept here so the rule lives with the actions. */
export async function assertPlatformAdmin() {
  return authorize('platform.view');
}

export { SYSTEM_ADMIN_ROLE_SLUG };
