import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORE_PERMISSION_KEYS, SYSTEM_ROLES, resolveRolePermissions } from '@/lib/permissions';
import {
  accountTier,
  canAssignRole,
  canEditRolePermissions,
  canManageAccount,
  type AccountOperation,
  type PolicyAccount,
} from '@/server/services/account-policy';

const roleOf = (slug: string) => {
  const definition = SYSTEM_ROLES.find((role) => role.slug === slug);
  if (!definition) throw new Error(`unknown role ${slug}`);
  return { slug, permissions: resolveRolePermissions(definition) };
};

const account = (id: string, slug: string): PolicyAccount & { roleId: string } => ({
  id,
  roleId: `role-${slug}`,
  role: roleOf(slug),
});

const admin = account('admin', 'system-admin');
const owner = account('owner', 'owner');
const cashier = account('cashier', 'cashier');
const stocker = account('stocker', 'inventory-staff');
// A custom role the owner delegated staff management to.
const supervisor: PolicyAccount & { roleId: string } = {
  id: 'supervisor',
  roleId: 'role-supervisor',
  role: { slug: 'supervisor', permissions: ['users.view', 'users.create', 'users.update', 'pos.view', 'pos.create'] },
};

const OPERATIONS: AccountOperation[] = ['edit', 'changeRole', 'changeStatus', 'resetPassword', 'delete'];

test('tiers come from the role, not from ids or names', () => {
  assert.equal(accountTier(admin.role), 'platform');
  assert.equal(accountTier(owner.role), 'owner');
  assert.equal(accountTier(cashier.role), 'staff');
  // A role holding a platform permission is platform-tier whatever its slug.
  assert.equal(accountTier({ slug: 'renamed', permissions: ['platform.view'] }), 'platform');
});

test('the owner role never resolves to platform permissions', () => {
  assert.ok([...owner.role.permissions].every((key) => (STORE_PERMISSION_KEYS as string[]).includes(key)));
});

test('no store account can touch the System Administrator, and the attempt reads as "not found"', () => {
  for (const actor of [owner, cashier, supervisor]) {
    for (const operation of OPERATIONS) {
      const decision = canManageAccount(actor, admin, operation);
      assert.equal(decision.allowed, false, `${actor.id} ${operation}`);
      assert.ok(!decision.allowed && decision.hidden);
    }
  }
});

test('the owner manages store staff', () => {
  for (const target of [cashier, stocker, supervisor]) {
    for (const operation of OPERATIONS) {
      assert.ok(canManageAccount(owner, target, operation).allowed, `${target.id} ${operation}`);
    }
  }
});

test('the owner may rename themselves but not deactivate, delete, reset or re-role their own account', () => {
  assert.ok(canManageAccount(owner, owner, 'edit').allowed);
  for (const operation of ['changeRole', 'changeStatus', 'resetPassword', 'delete'] as const) {
    assert.equal(canManageAccount(owner, owner, operation).allowed, false, operation);
  }
});

test('staff can never manage the owner', () => {
  for (const operation of OPERATIONS) {
    assert.equal(canManageAccount(supervisor, owner, operation).allowed, false, operation);
  }
});

test('staff cannot change their own role or status', () => {
  for (const operation of ['changeRole', 'changeStatus', 'resetPassword', 'delete'] as const) {
    assert.equal(canManageAccount(supervisor, supervisor, operation).allowed, false, operation);
  }
});

test('nobody in the store can assign Owner or System Administrator', () => {
  for (const actor of [owner, supervisor]) {
    assert.equal(canAssignRole(actor, owner.role).allowed, false);
    assert.equal(canAssignRole(actor, admin.role).allowed, false);
  }
});

test('the owner assigns any staff role; delegated staff only roles within their own access', () => {
  assert.ok(canAssignRole(owner, cashier.role).allowed);
  assert.ok(canAssignRole(owner, stocker.role).allowed);
  assert.ok(canAssignRole(supervisor, { slug: 'till-only', permissions: ['pos.view', 'pos.create'] }).allowed);
  assert.equal(canAssignRole(supervisor, cashier.role).allowed, false);
});

test('role permissions: platform and owner roles are fixed, and nobody edits their own role', () => {
  const adminRole = { id: admin.roleId, ...admin.role };
  const ownerRole = { id: owner.roleId, ...owner.role };
  const cashierRole = { id: cashier.roleId, ...cashier.role };

  const hidden = canEditRolePermissions(owner, adminRole, []);
  assert.ok(!hidden.allowed && hidden.hidden);
  assert.equal(canEditRolePermissions(owner, ownerRole, []).allowed, false);
  assert.ok(canEditRolePermissions(owner, cashierRole, ['pos.view']).allowed);

  // Self-escalation: a cashier given roles.update cannot widen the Cashier role.
  assert.equal(canEditRolePermissions(cashier, cashierRole, [...STORE_PERMISSION_KEYS]).allowed, false);
});

test('delegated staff cannot grant permissions they do not hold', () => {
  const stockerRole = { id: stocker.roleId, ...stocker.role };
  assert.equal(canEditRolePermissions(supervisor, stockerRole, ['users.delete']).allowed, false);
  assert.ok(canEditRolePermissions(supervisor, stockerRole, ['pos.view']).allowed);
});
