'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { APIError } from 'better-auth/api';
import { authorize, getCurrentUser } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { runAsProvisioning } from '@/lib/provisioning-context';
import { recordAudit } from '@/server/services/audit-service';
import { notify } from '@/server/services/notification-service';
import { ALL_PERMISSION_KEYS } from '@/lib/permissions';
import { slugify } from '@/lib/utils';
import { SETTING_DEFINITIONS } from '@/lib/settings-definitions';

/**
 * Administration: system settings, user accounts, and role permissions.
 *
 * These are the highest-privilege actions in the system, so each one re-checks
 * the caller's permission and writes an audit entry.
 */

// --- Settings ---------------------------------------------------------------

const settingsSchema = z.record(z.string(), z.string().max(2000));

const DEFINITION_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export async function updateSettings(input: unknown): Promise<ActionResult<number>> {
  return runAction(async () => {
    const user = await authorize('settings.update');
    const values = parseInput(settingsSchema, input);

    const changed: string[] = [];

    for (const [key, rawValue] of Object.entries(values)) {
      const definition = DEFINITION_BY_KEY.get(key);
      // Only keys in the catalogue are writable — this endpoint must not become
      // a way to plant arbitrary rows, including the document counters.
      if (!definition) continue;

      const value = rawValue.trim();

      if (definition.type === 'NUMBER' && value !== '' && !Number.isFinite(Number(value))) {
        throw new ValidationError(`${definition.label} must be a number.`, { [key]: ['Enter a number.'] });
      }
      if (definition.type === 'BOOLEAN' && value !== 'true' && value !== 'false') {
        throw new ValidationError(`${definition.label} must be true or false.`);
      }

      const existing = await prisma.setting.findUnique({ where: { key } });
      if (existing?.value === value) continue;

      await prisma.setting.upsert({
        where: { key },
        create: { ...definition, value },
        update: { value },
      });
      changed.push(key);
    }

    if (changed.length > 0) {
      await recordAudit({
        action: 'SETTINGS_CHANGE',
        entity: 'Setting',
        summary: `Updated ${changed.length} setting(s): ${changed.join(', ')}`,
        userId: user.id,
      });
    }

    revalidatePath('/settings');
    revalidatePath('/dashboard');
    return changed.length;
  });
}

// --- Users ------------------------------------------------------------------

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Enter a full name.').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(128)
    .regex(/[a-z]/, 'Include a lowercase letter.')
    .regex(/[A-Z]/, 'Include an uppercase letter.')
    .regex(/[0-9]/, 'Include a number.'),
  roleId: z.string().min(1, 'Choose a role.'),
  phone: z.string().trim().max(40).optional(),
});

export async function createUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const admin = await authorize('users.create');
    const values = parseInput(createUserSchema, input);

    const role = await prisma.role.findUnique({ where: { id: values.roleId } });
    if (!role) {
      throw new ValidationError('That role no longer exists.', {
        roleId: ['Pick a role from the list.'],
      });
    }

    // Checked up front so a duplicate reports against the email field rather
    // than surfacing as a generic failure from inside Better Auth.
    const existing = await prisma.user.findUnique({
      where: { email: values.email },
      select: { id: true },
    });
    if (existing) {
      throw new ValidationError('That email address already has an account.', {
        email: ['This email is already registered.'],
      });
    }

    // Better Auth owns password hashing, so the account is created through it
    // rather than by writing to the table directly. `runAsProvisioning` is what
    // tells the sign-up hook this is an authorised admin creation, not a public
    // registration.
    //
    // This creates no session: `emailAndPassword.autoSignIn` is off precisely
    // so that calling this from a Server Action cannot overwrite the
    // administrator's own session cookie with one for the new account.
    let created: Awaited<ReturnType<typeof auth.api.signUpEmail>>;
    try {
      created = await runAsProvisioning(async () =>
        auth.api.signUpEmail({
          body: { name: values.name, email: values.email, password: values.password },
        }),
      );
    } catch (error) {
      // Better Auth signals rejections (duplicate account, password policy) as
      // APIError. Translating it keeps a real reason in front of the admin
      // instead of collapsing to "something went wrong".
      if (error instanceof APIError) {
        const message =
          (error.body as { message?: string } | undefined)?.message ?? error.message;
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

    // Better Auth reports success on a duplicate email, returning a generated
    // id that was never inserted — the row is silently dropped by the unique
    // constraint. The pre-check above catches the ordinary case, but two admins
    // submitting the same address at once would both pass it, and the loser
    // would otherwise carry a phantom id into the update below and fail with an
    // unhelpful "record no longer exists".
    //
    // Confirming the row is really there closes that race against the database
    // rather than against a read that has already gone stale.
    const persisted = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!persisted) {
      throw new ValidationError('That email address already has an account.', {
        email: ['This email is already registered.'],
      });
    }

    // The sign-up hook assigns the default role; apply the chosen one. If this
    // fails the account would be left half-provisioned on the wrong role, so
    // the new user is removed rather than left in that state. Better Auth owns
    // the insert, so this compensating delete is the equivalent of a rollback.
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { roleId: values.roleId, phone: values.phone || null },
      });
    } catch (error) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      throw error;
    }

    await recordAudit({
      action: 'CREATE',
      entity: 'User',
      entityId: userId,
      summary: `Created user ${values.name} (${values.email}) with role ${role.name}`,
      userId: admin.id,
    });

    await notify({
      type: 'NEW_USER',
      title: `New user: ${values.name}`,
      message: `${values.email} was added with the ${role.name} role.`,
      link: '/settings/users',
    });

    revalidatePath('/settings/users');
    return { id: userId };
  });
}

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  roleId: z.string().min(1, 'Choose a role.'),
  phone: z.string().trim().max(40).optional(),
  isActive: z.boolean(),
});

export async function updateUser(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const admin = await authorize('users.update');
    const values = parseInput(updateUserSchema, input);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, isActive: true, role: { select: { slug: true, name: true } } },
    });
    if (!target) throw new NotFoundError('User');

    // Guard against an admin locking themselves out mid-session.
    if (admin.id === id && !values.isActive) {
      throw new ConflictError('You cannot deactivate your own account.');
    }

    const newRole = await prisma.role.findUnique({ where: { id: values.roleId }, select: { slug: true, name: true } });
    if (!newRole) throw new NotFoundError('Role');

    // The system must always retain at least one active owner.
    if (target.role.slug === 'owner' && (newRole.slug !== 'owner' || !values.isActive)) {
      const otherOwners = await prisma.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) {
        throw new ConflictError(
          'This is the last active Owner. Promote another user to Owner before changing this account.',
        );
      }
    }

    await prisma.user.update({
      where: { id },
      data: {
        name: values.name,
        roleId: values.roleId,
        phone: values.phone || null,
        isActive: values.isActive,
      },
    });

    // Revoking access should take effect immediately, not when the cookie expires.
    if (!values.isActive) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }

    await recordAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      summary: `Updated user ${target.email} — role ${target.role.name} → ${newRole.name}, ${
        values.isActive ? 'active' : 'deactivated'
      }`,
      userId: admin.id,
    });

    revalidatePath('/settings/users');
    return { id };
  });
}

export async function deleteUser(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const admin = await authorize('users.delete');

    if (admin.id === id) throw new ConflictError('You cannot delete your own account.');

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        email: true,
        name: true,
        role: { select: { slug: true } },
        _count: { select: { sales: true, purchaseOrders: true, expenses: true } },
      },
    });
    if (!target) throw new NotFoundError('User');

    const activity = target._count.sales + target._count.purchaseOrders + target._count.expenses;
    if (activity > 0) {
      throw new ConflictError(
        `${target.name} has ${activity} transaction(s) on record. Deactivate the account instead — deleting it would break the audit trail.`,
      );
    }

    if (target.role.slug === 'owner') {
      const otherOwners = await prisma.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) throw new ConflictError('You cannot delete the last Owner account.');
    }

    await prisma.user.delete({ where: { id } });

    await recordAudit({
      action: 'DELETE',
      entity: 'User',
      entityId: id,
      summary: `Deleted user ${target.email}`,
      userId: admin.id,
    });

    revalidatePath('/settings/users');
  });
}

// --- Roles ------------------------------------------------------------------

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name.').max(60),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((value) => (value === '' ? null : value))
    .nullable(),
  permissions: z.array(z.string()).default([]),
});

export async function createRole(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const admin = await authorize('roles.create');
    const values = parseInput(roleSchema, input);

    // Ignore anything not in the catalogue — a tampered payload cannot invent
    // a permission the application does not define.
    const valid = values.permissions.filter((key) => ALL_PERMISSION_KEYS.includes(key as never));
    const permissions = await prisma.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    const role = await prisma.role.create({
      data: {
        name: values.name,
        slug: slugify(values.name),
        description: values.description,
        isSystem: false,
        permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
      select: { id: true },
    });

    await recordAudit({
      action: 'CREATE',
      entity: 'Role',
      entityId: role.id,
      summary: `Created role ${values.name} with ${permissions.length} permission(s)`,
      userId: admin.id,
    });

    revalidatePath('/settings/roles');
    return { id: role.id };
  });
}

export async function updateRolePermissions(
  roleId: string,
  permissionKeys: string[],
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const admin = await authorize('roles.update');

    const role = await prisma.role.findUnique({ where: { id: roleId }, select: { name: true, slug: true } });
    if (!role) throw new NotFoundError('Role');

    // Owner is intentionally not editable — it is the recovery path if another
    // role is misconfigured.
    if (role.slug === 'owner') {
      throw new ConflictError('The Owner role always has full access and cannot be restricted.');
    }

    const valid = permissionKeys.filter((key) => ALL_PERMISSION_KEYS.includes(key as never));
    const permissions = await prisma.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
        skipDuplicates: true,
      }),
    ]);

    await recordAudit({
      action: 'UPDATE',
      entity: 'Role',
      entityId: roleId,
      summary: `Set ${role.name} to ${permissions.length} permission(s)`,
      userId: admin.id,
    });

    revalidatePath('/settings/roles');
    return permissions.length;
  });
}

export async function deleteRole(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const admin = await authorize('roles.delete');

    const role = await prisma.role.findUnique({
      where: { id },
      select: { name: true, isSystem: true, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundError('Role');

    if (role.isSystem) throw new ConflictError('Built-in roles cannot be deleted.');
    if (role._count.users > 0) {
      throw new ConflictError(
        `${role._count.users} user(s) still have this role. Reassign them before deleting it.`,
      );
    }

    await prisma.role.delete({ where: { id } });

    await recordAudit({
      action: 'DELETE',
      entity: 'Role',
      entityId: id,
      summary: `Deleted role ${role.name}`,
      userId: admin.id,
    });

    revalidatePath('/settings/roles');
  });
}

// --- Profile ----------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(80),
  phone: z.string().trim().max(40).optional(),
});

/** Self-service profile update — no admin permission required. */
export async function updateOwnProfile(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new NotFoundError('Session');

    const values = parseInput(profileSchema, input);

    await prisma.user.update({
      where: { id: user.id },
      data: { name: values.name, phone: values.phone || null },
    });

    await recordAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      summary: 'Updated own profile',
      userId: user.id,
    });

    revalidatePath('/settings/profile');
  });
}
