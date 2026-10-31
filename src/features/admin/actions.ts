'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { getStoreContext, storeDb } from '@/lib/tenant/context';
import { auth } from '@/lib/auth';
import { APIError } from 'better-auth/api';
import { authenticate, authorize, type CurrentUser } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ConflictError, ForbiddenError, NotFoundError, PlanLimitError, ValidationError } from '@/lib/errors';
import { planLimitFromDatabase } from '@/lib/plans';
import { shiftReference } from '@/lib/shift-review';
import { runAsProvisioning } from '@/lib/provisioning-context';
import { recordAudit, recordAuditFor } from '@/server/services/audit-service';
import { PRIVILEGED_ROLE_SLUGS, STORE_PERMISSION_KEYS } from '@/lib/permissions';
import {
  accountTier,
  canAssignRole,
  canEditRolePermissions,
  canManageAccount,
  type AccountOperation,
  type PolicyDecision,
} from '@/server/services/account-policy';
import { slugify } from '@/lib/utils';
import {
  SETTING_DEFINITIONS,
  settingProblem,
  settingRow,
  type SettingDefinition,
} from '@/lib/settings-definitions';
import { normalizeUsername, usernameProblem } from '@/lib/username';
import { requireFeature, requireWithinLimit, requireWritable } from '@/server/services/entitlements';
import { deleteStoredImage, uploadStoreLogo } from '@/server/services/storage-service';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Administration: system settings, user accounts, and role permissions.
 *
 * These are the highest-privilege actions in the system, so each one re-checks
 * the caller's permission and writes an audit entry.
 *
 * Everything goes through the caller's store client, so an id from another
 * store is simply "not found". The exceptions use the platform client and are
 * marked: usernames and emails are unique across the whole platform, and a
 * user editing their own profile may be a platform administrator.
 */

// --- Settings ---------------------------------------------------------------

const settingsSchema = z.record(z.string(), z.string().max(2000));

const DEFINITION_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export async function updateSettings(input: unknown): Promise<ActionResult<number>> {
  return runAction(async () => {
    const user = await authorize('settings.update');
    const values = parseInput(settingsSchema, input);

    const { db, storeId } = await getStoreContext();
    const stored = await db.setting.findMany({ where: { key: { in: Object.keys(values) } } });
    const current = new Map(stored.map((row) => [row.key, row.value]));

    // Every value is checked before anything is written, so one bad field
    // cannot leave a save half-applied. Only changed values are checked: a
    // value stored before a rule existed does not block saving other fields.
    const updates: { definition: SettingDefinition; value: string }[] = [];
    const fieldErrors: Record<string, string[]> = {};

    for (const [key, rawValue] of Object.entries(values)) {
      const definition = DEFINITION_BY_KEY.get(key);
      // Only keys in the catalogue are writable — this endpoint must not become
      // a way to plant arbitrary rows, including the document counters.
      if (!definition) continue;

      const value = rawValue.trim();
      if (current.has(key) && current.get(key) === value) continue;

      const problem = settingProblem(definition, value);
      if (problem) {
        fieldErrors[key] = [problem];
        continue;
      }
      updates.push({ definition, value });
    }

    const invalid = Object.keys(fieldErrors);
    if (invalid.length > 0) {
      const first = DEFINITION_BY_KEY.get(invalid[0])!;
      throw new ValidationError(
        invalid.length === 1
          ? `${first.label}: ${fieldErrors[invalid[0]][0]}`
          : `${invalid.length} settings need attention. Nothing was saved.`,
        fieldErrors,
      );
    }

    const changed: string[] = [];
    for (const { definition, value } of updates) {
      await db.setting.upsert({
        where: { storeId_key: { storeId, key: definition.key } },
        create: { ...settingRow(definition), value },
        update: { value },
      });
      changed.push(definition.key);
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

// --- Store logo -------------------------------------------------------------

const LOGO_KEY = 'company.logoUrl';

/**
 * Stores `url` as the logo and removes the previous file. The old file goes
 * only after the new value is saved, so a failure at any step leaves the
 * store with a working logo.
 */
async function replaceLogo(userId: string, url: string, summary: string): Promise<void> {
  const { db, storeId } = await getStoreContext();
  const definition = DEFINITION_BY_KEY.get(LOGO_KEY)!;
  const previous = (await db.setting.findFirst({ where: { key: LOGO_KEY } }))?.value ?? '';

  try {
    await db.setting.upsert({
      where: { storeId_key: { storeId, key: LOGO_KEY } },
      create: { ...settingRow(definition), value: url },
      update: { value: url },
    });
  } catch (error) {
    // Not saved, so nothing refers to the new upload; do not leave it behind.
    if (url) await deleteStoredImage(url, storeId);
    throw error;
  }
  await recordAudit({ action: 'SETTINGS_CHANGE', entity: 'Setting', summary, userId });

  // Only this store's own uploads are ever removed; a pasted external URL is skipped.
  if (previous && previous !== url) await deleteStoredImage(previous, storeId);

  revalidatePath('/settings');
}

export async function uploadStoreLogoAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const user = await authorize('settings.update');
    checkRateLimit(`store-logo:${user.id}`, { limit: 10, windowMs: 60_000 });

    const file = formData.get('file');
    if (!(file instanceof File)) throw new ConflictError('No file was received.');

    // Storage is outside the store client, so a read-only store is refused here.
    const { storeId } = await requireWritable();
    const url = await uploadStoreLogo(file, storeId);
    await replaceLogo(user.id, url, 'Updated the store logo');
    return { url };
  });
}

export async function removeStoreLogoAction(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('settings.update');
    await requireWritable();
    await replaceLogo(user.id, '', 'Removed the store logo');
  });
}

// --- Users ------------------------------------------------------------------

// Who may manage which account is decided by `account-policy`. Every action
// below reloads the target and asks it — the staff list hiding a row or a menu
// item is convenience, not the control.

function policyActor(user: CurrentUser) {
  return { id: user.id, roleId: user.role.id, role: { slug: user.role.slug, permissions: user.permissions } };
}

function enforce(decision: PolicyDecision, entity: string): void {
  if (decision.allowed) return;
  throw decision.hidden ? new NotFoundError(entity) : new ForbiddenError(decision.reason);
}

const ROLE_POLICY_SELECT = {
  id: true,
  name: true,
  slug: true,
  permissions: { select: { permission: { select: { key: true } } } },
} as const;

const toPolicyRole = (role: { slug: string; permissions: { permission: { key: string } }[] }) => ({
  slug: role.slug,
  permissions: role.permissions.map((item) => item.permission.key),
});

/** Loads an account and checks `actor` may perform every listed operation on it. */
async function loadManagedAccount(actor: CurrentUser, id: string, operations: AccountOperation[]) {
  const db = await storeDb();
  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      isActive: true,
      roleId: true,
      role: { select: ROLE_POLICY_SELECT },
      _count: { select: { sales: true } },
    },
  });
  if (!target) throw new NotFoundError('User');

  const subject = { id: target.id, role: toPolicyRole(target.role) };
  for (const operation of operations) {
    enforce(canManageAccount(policyActor(actor), subject, operation), 'User');
  }
  return target;
}

/** Loads a role and checks `actor` may assign it to an account. */
async function loadAssignableRole(actor: CurrentUser, roleId: string) {
  const db = await storeDb();
  const role = await db.role.findUnique({ where: { id: roleId }, select: ROLE_POLICY_SELECT });
  if (!role) {
    throw new ValidationError('That role no longer exists.', { roleId: ['Pick a role from the list.'] });
  }
  const decision = canAssignRole(policyActor(actor), toPolicyRole(role));
  if (!decision.allowed) throw new ValidationError(decision.reason, { roleId: ['Choose a staff role.'] });
  return role;
}

// Mirrors `validatePassword` in src/lib/password.ts and the hook in
// src/lib/auth.ts. Without the special-character rule this schema would accept
// a password that Better Auth then rejects, surfacing the failure against no
// field at all.
const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a number.')
  .regex(/[^A-Za-z0-9]/, 'Include a special character.');

// Normalised first, then checked, so "Juan.Cruz " is stored as "juan.cruz" —
// the same rules the sign-in endpoint and the database constraint apply.
const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .superRefine((value, ctx) => {
    const problem = usernameProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const USERNAME_TAKEN = new ValidationError('That username is already taken.', {
  username: ['This username is already in use.'],
});

/**
 * Refuses a username another account holds. Case-insensitive because both
 * sides are normalised. Usernames are unique across every store (sign-in has
 * no store picker), so this asks the platform client, for an id only.
 */
async function assertUsernameFree(username: string, exceptUserId?: string): Promise<void> {
  const holder = await platformPrisma.user.findUnique({ where: { username }, select: { id: true } });
  if (holder && holder.id !== exceptUserId) throw USERNAME_TAKEN;
}

/** Turns a unique-constraint race on `username` into the same field error as the pre-check. */
function rethrowUsernameConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String(error.meta?.target ?? '').includes('username')
  ) {
    throw USERNAME_TAKEN;
  }
  throw error;
}

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Enter a full name.').max(80),
  username: usernameSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: passwordSchema,
  roleId: z.string().min(1, 'Choose a role.'),
  phone: z.string().trim().max(40).optional(),
  isActive: z.boolean().default(true),
});

export async function createUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const admin = await authorize('users.create');
    const values = parseInput(createUserSchema, input);

    // Owner and administrator accounts come from the platform administrator,
    // never from here, and delegated staff cannot hand out more than they
    // hold. Enforced on the server, not just by filtering the dropdown, so a
    // crafted payload cannot mint a privileged account.
    const role = await loadAssignableRole(admin, values.roleId);
    // The plan's staff quota (an inactive account does not count). Account
    // creation runs through Better Auth on the platform client, so this is
    // also where a read-only store is refused. The database trigger holds the
    // quota if two requests race.
    const { db, storeId } = await requireWithinLimit('staff', values.isActive ? 1 : 0);

    // Checked up front so a duplicate reports against the email field rather
    // than surfacing as a generic failure from inside Better Auth. Emails are
    // unique across every store, so this asks the platform client.
    const existing = await platformPrisma.user.findUnique({
      where: { email: values.email },
      select: { id: true },
    });
    if (existing) {
      throw new ValidationError('That email address already has an account.', {
        email: ['This email is already registered.'],
      });
    }
    await assertUsernameFree(values.username);

    // Better Auth owns password hashing, so the account is created through it
    // rather than by writing to the table directly. `runAsProvisioning` is what
    // tells the sign-up hook this is an authorised admin creation, not a public
    // registration, and which store and role the new account gets.
    //
    // This creates no session: `emailAndPassword.autoSignIn` is off precisely
    // so that calling this from a Server Action cannot overwrite the
    // administrator's own session cookie with one for the new account.
    let created: Awaited<ReturnType<typeof auth.api.signUpEmail>>;
    try {
      created = await runAsProvisioning({ storeId, roleId: role.id, isActive: values.isActive }, async () =>
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
      // Two requests racing for the last seat both pass the check above; the
      // database quota trigger refuses the second. Say so plainly, however
      // Better Auth wrapped the database error.
      const quota = planLimitFromDatabase(errorText(error));
      if (quota) throw new PlanLimitError(quota);
      // Better Auth signals rejections (duplicate account, password policy) as
      // APIError. Translating it keeps a real reason in front of the admin
      // instead of collapsing to "something went wrong".
      if (error instanceof APIError) {
        const message =
          (error.body as { message?: string } | undefined)?.message ?? error.message;
        if (/username/i.test(message)) {
          throw /taken/i.test(message)
            ? USERNAME_TAKEN
            : new ValidationError(message, { username: [message] });
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

    // Better Auth reports success on a duplicate email, returning a generated
    // id that was never inserted — the row is silently dropped by the unique
    // constraint. The pre-check above catches the ordinary case, but two admins
    // submitting the same address at once would both pass it, and the loser
    // would otherwise carry a phantom id into the update below and fail with an
    // unhelpful "record no longer exists".
    //
    // Confirming the row is really there closes that race against the database
    // rather than against a read that has already gone stale.
    const persisted = await db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!persisted) {
      // The insert can also have been refused by the staff quota trigger
      // when another request took the last seat first; report that instead.
      await requireWithinLimit('staff', values.isActive ? 1 : 0);
      throw new ValidationError('That email address already has an account.', {
        email: ['This email is already registered.'],
      });
    }

    // The sign-up hook assigns the default role; apply the chosen one. If this
    // fails the account would be left half-provisioned on the wrong role, so
    // the new user is removed rather than left in that state. Better Auth owns
    // the insert, so this compensating delete is the equivalent of a rollback.
    try {
      await db.user.update({
        where: { id: userId },
        data: { roleId: values.roleId, phone: values.phone || null, isActive: values.isActive },
      });
    } catch (error) {
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);
      throw error;
    }

    await recordAudit({
      action: 'CREATE',
      entity: 'User',
      entityId: userId,
      summary: `Created user ${values.name} (@${values.username}, ${values.email}) with role ${role.name}${
        values.isActive ? '' : ', inactive'
      }`,
      userId: admin.id,
    });

    revalidatePath('/settings/users');
    return { id: userId };
  });
}

/** An error's message together with its causes', for spotting a database refusal inside a wrapper. */
function errorText(error: unknown): string {
  const parts: string[] = [];
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' | ');
}

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: usernameSchema,
  roleId: z.string().min(1, 'Choose a role.'),
  phone: z.string().trim().max(40).optional(),
  isActive: z.boolean(),
});

export async function updateUser(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const admin = await authorize('users.update');
    const values = parseInput(updateUserSchema, input);

    const target = await loadManagedAccount(admin, id, ['edit']);
    const db = await storeDb();

    // Only the operations this request actually performs are checked, so the
    // owner can still rename themselves while a status or role change on their
    // own row — or on any row above their tier — is refused.
    const subject = { id: target.id, role: toPolicyRole(target.role) };
    if (values.roleId !== target.roleId) {
      enforce(canManageAccount(policyActor(admin), subject, 'changeRole'), 'User');
    }
    // Status has its own action (setUserStatus): it records a reason and
    // handles an open shift. Refused here so this route cannot skip that.
    if (values.isActive !== target.isActive) {
      throw new ConflictError('Use Disable or Enable account to change whether this account can sign in.');
    }

    const newRole =
      values.roleId === target.roleId ? target.role : await loadAssignableRole(admin, values.roleId);

    // Promotion to Owner is not an edit — the owner is created by the platform
    // administrator. `loadAssignableRole` already refuses it; this keeps the
    // rule explicit for a re-save that names a privileged role.
    if (PRIVILEGED_ROLE_SLUGS.includes(newRole.slug) && newRole.slug !== target.role.slug) {
      throw new ConflictError('Staff accounts cannot be promoted to Owner.');
    }

    // The system must always retain at least one active owner.
    if (target.role.slug === 'owner' && (newRole.slug !== 'owner' || !values.isActive)) {
      const otherOwners = await db.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) {
        throw new ConflictError(
          'This is the last active Owner. Promote another user to Owner before changing this account.',
        );
      }
    }

    const usernameChanged = values.username !== target.username;
    if (usernameChanged) await assertUsernameFree(values.username, id);

    await db.user
      .update({
        where: { id },
        data: {
          name: values.name,
          ...(usernameChanged && { username: values.username, displayUsername: values.username }),
          roleId: values.roleId,
          phone: values.phone || null,
          isActive: values.isActive,
        },
      })
      .catch(rethrowUsernameConflict);

    await recordAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      summary: `Updated user ${target.email} — ${
        usernameChanged ? `username @${target.username} → @${values.username}, ` : ''
      }role ${target.role.name} → ${newRole.name}`,
      userId: admin.id,
    });

    revalidatePath('/settings/users');
    return { id };
  });
}

const statusSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().max(200).optional(),
  // Deactivating someone with an open shift: the owner confirmed it should
  // stay open for them to count and close from Shift Management.
  leaveShiftOpen: z.boolean().default(false),
});

/**
 * Turns a staff account on or off. Only the owner (or staff the owner
 * delegated users.update to) may, never on their own account, and never on
 * the owner's — the account policy decides. Nothing is deleted: sales,
 * shifts, stock movements and audit entries keep the account's name.
 *
 * Deactivating signs the account out everywhere at once. If the person has
 * a shift open, the drawer still holds the shift's cash, so the default is to
 * refuse until the owner closes it; `leaveShiftOpen` deactivates anyway (a
 * lost phone, suspected theft) and leaves the shift for the owner to close.
 * Reactivating takes a seat in the plan's staff quota, so switching accounts
 * off and on can never get round the limit.
 */
export async function setUserStatus(id: string, input: unknown): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  return runAction(async () => {
    const admin = await authorize('users.update');
    const values = parseInput(statusSchema, input);
    const target = await loadManagedAccount(admin, id, ['changeStatus']);
    const db = await storeDb();
    const reason = values.reason?.trim() || null;

    if (values.isActive === target.isActive) return { id, isActive: target.isActive };

    if (values.isActive) {
      await requireWithinLimit('staff');
    }

    const openShift = values.isActive
      ? null
      : await db.cashierShift.findFirst({ where: { userId: id, status: 'OPEN' }, select: { id: true, number: true } });
    if (openShift && !values.leaveShiftOpen) {
      throw new ConflictError(
        `${target.name} has shift ${shiftReference(openShift.number)} open. Close it from Shift Management after counting the drawer, or confirm that it should stay open for you to close.`,
      );
    }

    await db.user.update({ where: { id }, data: { isActive: values.isActive } });
    // Access ends now, not when the cookie expires.
    if (!values.isActive) await db.session.deleteMany({ where: { userId: id } });

    await recordAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      summary: `${values.isActive ? 'Reactivated' : 'Deactivated'} ${target.name} (@${target.username})${reason ? `: ${reason}` : ''}${
        openShift ? ` — shift ${shiftReference(openShift.number)} left open for the owner to close` : ''
      }`,
      changes: {
        isActive: { from: target.isActive, to: values.isActive },
        reason,
        ...(openShift ? { openShiftLeftOpen: shiftReference(openShift.number) } : {}),
      },
      userId: admin.id,
    });

    revalidatePath('/settings/users');
    revalidatePath('/shifts', 'layout');
    return { id, isActive: values.isActive };
  });
}

const resetPasswordSchema = z.object({ password: passwordSchema });

/**
 * Sets a new password for a staff account on the owner's behalf, for when
 * someone forgets theirs.
 *
 * Hashing goes through Better Auth's own context rather than writing to the
 * `accounts` table directly, so the stored hash is produced by exactly the same
 * code path that sign-in verifies against.
 */
export async function resetUserPassword(id: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const admin = await authorize('users.update');
    const values = parseInput(resetPasswordSchema, input);

    // Without this check any holder of `users.update` could set the password
    // of the Owner or the System Administrator and sign in as them.
    const target = await loadManagedAccount(admin, id, ['resetPassword']);

    const ctx = await auth.$context;
    const hash = await ctx.password.hash(values.password);
    await ctx.internalAdapter.updatePassword(id, hash);

    // The old password is gone, so any session opened with it should be too —
    // this is the same reasoning as `revokeOtherSessions` on a self-service
    // change, and it forces the staff member to sign in with the new one.
    await (await storeDb()).session.deleteMany({ where: { userId: id } });

    await recordAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      summary: `Reset password for ${target.email}`,
      userId: admin.id,
    });

    revalidatePath('/settings/users');
  });
}

/**
 * Removes every passkey on a staff account — for a lost phone or a device
 * that changed hands. The account and its password are untouched, and its
 * open sessions end so whoever held the device is signed out too.
 */
export async function revokeUserPasskeys(id: string): Promise<ActionResult<{ removed: number }>> {
  return runAction(async () => {
    const admin = await authorize('users.update');

    // Same hierarchy as a password reset: both control how the account signs in.
    const target = await loadManagedAccount(admin, id, ['resetPassword']);

    const db = await storeDb();
    const [{ count }] = await db.$transaction([
      db.passkey.deleteMany({ where: { userId: id } }),
      db.session.deleteMany({ where: { userId: id } }),
    ]);

    await recordAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      summary: `Revoked ${count} passkey${count === 1 ? '' : 's'} for ${target.email}`,
      userId: admin.id,
    });

    revalidatePath('/settings/users');
    return { removed: count };
  });
}

export async function deleteUser(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const admin = await authorize('users.delete');

    if (admin.id === id) throw new ConflictError('You cannot delete your own account.');

    const target = await loadManagedAccount(admin, id, ['delete']);
    const db = await storeDb();

    const activity = target._count.sales;
    if (activity > 0) {
      throw new ConflictError(
        `${target.name} has ${activity} transaction(s) on record. Deactivate the account instead — deleting it would break the audit trail.`,
      );
    }

    if (target.role.slug === 'owner') {
      const otherOwners = await db.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) throw new ConflictError('You cannot delete the last Owner account.');
    }

    await db.user.delete({ where: { id } });

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
    await requireFeature('customRoles');
    const values = parseInput(roleSchema, input);

    // Ignore anything not in the catalogue — a tampered payload cannot invent
    // a permission the application does not define.
    const valid = values.permissions.filter((key) => STORE_PERMISSION_KEYS.includes(key as never));

    // Delegated staff cannot mint a role broader than their own and then
    // assign it — only the owner grants what they do not personally hold.
    enforce(
      canEditRolePermissions(policyActor(admin), { id: '', slug: slugify(values.name), permissions: valid }, valid),
      'Role',
    );

    const db = await storeDb();
    const permissions = await db.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    const role = await db.role.create({
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

    const db = await storeDb();
    const role = await db.role.findUnique({ where: { id: roleId }, select: { ...ROLE_POLICY_SELECT, isSystem: true } });
    if (!role) throw new NotFoundError('Role');
    // Changing any role's permissions — built-in or custom — needs a plan with
    // custom roles; Basic uses the built-in roles as they come. Checked here,
    // on the server, so a direct call cannot get round the locked editor. A
    // store that downgraded keeps its roles and their current permissions (and
    // can still assign or delete custom ones); it just cannot reshape them.
    await requireFeature('customRoles');

    const valid = permissionKeys.filter((key) => STORE_PERMISSION_KEYS.includes(key as never));

    // Owner is intentionally not editable — it is the recovery path if another
    // role is misconfigured. The System Administrator role is not the store's
    // to change at all: rewriting it would lock the administrator out of the
    // platform. Nobody edits the role they hold themselves.
    enforce(
      canEditRolePermissions(policyActor(admin), { id: role.id, ...toPolicyRole(role) }, valid),
      'Role',
    );

    const permissions = await db.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId } }),
      db.rolePermission.createMany({
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

    const db = await storeDb();
    const role = await db.role.findUnique({
      where: { id },
      select: { ...ROLE_POLICY_SELECT, isSystem: true, _count: { select: { users: true } } },
    });
    // Platform roles are invisible to the store, whatever their `isSystem` flag.
    if (!role || accountTier(toPolicyRole(role)) === 'platform') throw new NotFoundError('Role');

    if (role.isSystem) throw new ConflictError('Built-in roles cannot be deleted.');
    if (role._count.users > 0) {
      throw new ConflictError(
        `${role._count.users} user(s) still have this role. Reassign them before deleting it.`,
      );
    }

    await db.role.delete({ where: { id } });

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
    const user = await authenticate();

    const values = parseInput(profileSchema, input);

    // Platform administrators have a profile too but no store, so this writes
    // through the platform client, limited to the caller's own row.
    await platformPrisma.user.update({
      where: { id: user.id },
      data: { name: values.name, phone: values.phone || null },
    });

    await recordAuditFor(user, {
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      summary: 'Updated own profile',
      userId: user.id,
    });

    revalidatePath('/settings/profile');
  });
}
