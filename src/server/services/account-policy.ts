import type { Prisma } from '@prisma/client';
import { OWNER_ROLE_SLUG, SYSTEM_ADMIN_ROLE_SLUG } from '@/lib/permissions';

/**
 * Who may manage which account.
 *
 * Accounts fall into three tiers, derived from the role — never from an id,
 * email or name:
 *
 *  * platform — the System Administrator. Lives above the store; no store
 *    screen may list, edit, reset or remove it.
 *  * owner    — the store owner. Managed by the administrator; inside the store
 *    only the owner themselves may touch it, and only their name and phone.
 *  * staff    — everyone else. Managed by the owner, or by staff the owner has
 *    delegated `users.*` to — but never in a way that hands out more than the
 *    delegate already holds.
 *
 * Kept free of database and session imports so the rules are unit-testable;
 * the server actions load the rows and ask these functions.
 */

export type AccountTier = 'platform' | 'owner' | 'staff';

export interface PolicyRole {
  slug: string;
  /** Permission keys the role holds. */
  permissions: Iterable<string>;
}

export interface PolicyAccount {
  id: string;
  role: PolicyRole;
}

export type AccountOperation = 'edit' | 'changeRole' | 'changeStatus' | 'resetPassword' | 'delete';

export type PolicyDecision =
  | { allowed: true }
  // `hidden` targets are reported as "not found" so a crafted request cannot
  // confirm that a platform account exists.
  | { allowed: false; hidden: boolean; reason: string };

const ALLOW: PolicyDecision = { allowed: true };
const deny = (reason: string, hidden = false): PolicyDecision => ({ allowed: false, hidden, reason });

function holdsPlatformPermission(role: PolicyRole): boolean {
  for (const key of role.permissions) if (key.startsWith('platform.')) return true;
  return false;
}

export function accountTier(role: PolicyRole): AccountTier {
  if (role.slug === SYSTEM_ADMIN_ROLE_SLUG || holdsPlatformPermission(role)) return 'platform';
  if (role.slug === OWNER_ROLE_SLUG) return 'owner';
  return 'staff';
}

/**
 * Database filter for accounts that belong to the store — excludes every
 * platform-tier account by the same rule as `accountTier`.
 */
export const STORE_ACCOUNT_WHERE: Prisma.UserWhereInput = {
  role: {
    slug: { not: SYSTEM_ADMIN_ROLE_SLUG },
    permissions: { none: { permission: { resource: 'platform' } } },
  },
};

/** Whether `actor` may perform `operation` on `target` from the store's staff screens. */
export function canManageAccount(
  actor: PolicyAccount,
  target: PolicyAccount,
  operation: AccountOperation,
): PolicyDecision {
  const actorTier = accountTier(actor.role);
  const targetTier = accountTier(target.role);

  if (targetTier === 'platform') return deny('Account not found.', true);
  // Administrators manage owners from the platform screens, not from here.
  if (actorTier === 'platform') return deny('Use the system administration screens to manage accounts.');

  const isSelf = actor.id === target.id;

  if (targetTier === 'owner') {
    if (actorTier === 'owner' && isSelf && operation === 'edit') return ALLOW;
    if (isSelf) {
      return deny(
        operation === 'resetPassword'
          ? 'Change your own password from your Profile page.'
          : 'You cannot change your own role, status or account from the staff list.',
      );
    }
    return deny('The Owner account is managed by the System Administrator.');
  }

  // Target is staff.
  if (isSelf && operation !== 'edit') {
    return deny(
      operation === 'resetPassword'
        ? 'Change your own password from your Profile page.'
        : 'You cannot change your own role, status or account.',
    );
  }
  return ALLOW;
}

/**
 * Whether `actor` may hand `role` to an account — on create, or on a role change.
 *
 * Owner and platform roles are never assignable from the store. Delegated
 * staff may only assign roles that grant nothing they do not already hold, so
 * `users.create` cannot be turned into a route to wider access.
 */
export function canAssignRole(actor: PolicyAccount, role: PolicyRole): PolicyDecision {
  const roleTier = accountTier(role);
  if (roleTier !== 'staff') return deny('Owner and administrator roles cannot be assigned here.');

  const actorTier = accountTier(actor.role);
  if (actorTier === 'owner') return ALLOW;
  if (actorTier === 'platform') return deny('Use the system administration screens to manage accounts.');

  return isSubset(role.permissions, actor.role.permissions)
    ? ALLOW
    : deny('You cannot assign a role with permissions you do not have yourself.');
}

/**
 * Whether `actor` may set `role`'s permissions to `nextPermissions`.
 *
 * The Owner and platform roles are fixed; nobody edits the role they hold
 * themselves (the classic self-escalation); and delegated staff may only grant
 * permissions they already hold.
 */
export function canEditRolePermissions(
  actor: PolicyAccount & { roleId: string },
  role: PolicyRole & { id: string },
  nextPermissions: Iterable<string>,
): PolicyDecision {
  const roleTier = accountTier(role);
  if (roleTier === 'platform') return deny('Role not found.', true);
  if (roleTier === 'owner') return deny('The Owner role always has full access and cannot be restricted.');
  if (role.id === actor.roleId) return deny('You cannot change the permissions of your own role.');

  const actorTier = accountTier(actor.role);
  if (actorTier === 'owner') return ALLOW;
  if (actorTier === 'platform') return deny('Use the system administration screens to manage roles.');

  return isSubset(nextPermissions, actor.role.permissions)
    ? ALLOW
    : deny('You cannot grant permissions you do not have yourself.');
}

function isSubset(candidate: Iterable<string>, of: Iterable<string>): boolean {
  const held = new Set(of);
  for (const key of candidate) if (!held.has(key)) return false;
  return true;
}
