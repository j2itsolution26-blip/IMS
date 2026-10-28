import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canManageAccount } from '@/server/services/account-policy';

const actions = readFileSync('src/features/admin/actions.ts', 'utf8');
const statusAction = actions.slice(actions.indexOf('export async function setUserStatus'), actions.indexOf('const resetPasswordSchema'));
const updateAction = actions.slice(actions.indexOf('export async function updateUser'), actions.indexOf('const statusSchema'));

const owner = { id: 'o', role: { slug: 'owner', permissions: ['users.update'] } };
const cashier = { id: 'c', role: { slug: 'cashier', permissions: ['pos.create'] } };
const delegate = { id: 'd', role: { slug: 'supervisor', permissions: ['users.update'] } };

test('only an authorised account may change a status, never its own or the owner’s', () => {
  assert.equal(canManageAccount(owner, cashier, 'changeStatus').allowed, true);
  assert.equal(canManageAccount(delegate, cashier, 'changeStatus').allowed, true);
  // Nobody re-activates or deactivates themselves.
  assert.equal(canManageAccount(cashier, cashier, 'changeStatus').allowed, false);
  assert.equal(canManageAccount(delegate, delegate, 'changeStatus').allowed, false);
  // The owner's account is the System Administrator's to manage.
  assert.equal(canManageAccount(delegate, owner, 'changeStatus').allowed, false);
  assert.match(statusAction, /authorize\('users\.update'\)/);
  assert.match(statusAction, /loadManagedAccount\(admin, id, \['changeStatus'\]\)/);
});

test('deactivating signs the account out everywhere and keeps every record', () => {
  assert.match(statusAction, /session\.deleteMany\(\{ where: \{ userId: id \} \}\)/);
  assert.doesNotMatch(statusAction, /user\.delete|sale\.|cashMovement\.|inventoryTransaction\./);
});

test('an open shift blocks deactivation unless the owner chooses to leave it open', () => {
  assert.match(statusAction, /cashierShift\.findFirst\(\{ where: \{ userId: id, status: 'OPEN' \}/);
  assert.match(statusAction, /if \(openShift && !values\.leaveShiftOpen\)/);
  assert.match(statusAction, /left open for the owner to close/);
});

test('reactivating takes a seat in the plan, so switching off and on cannot beat the staff limit', () => {
  const reactivate = statusAction.slice(statusAction.indexOf('if (values.isActive) {'));
  assert.match(reactivate.slice(0, 80), /requireWithinLimit\('staff'\)/);
});

test('who changed the status, when and why is in the audit log', () => {
  assert.match(statusAction, /isActive: \{ from: target\.isActive, to: values\.isActive \}/);
  assert.match(statusAction, /reason,/);
  assert.match(statusAction, /userId: admin\.id/);
});

test('the general edit cannot change a status, so the open-shift rule cannot be skipped', () => {
  assert.match(updateAction, /if \(values\.isActive !== target\.isActive\) \{\s*throw new ConflictError/);
  assert.doesNotMatch(updateAction, /session\.deleteMany/);
});

test('a deactivated account is refused on every request, not just at sign-in', () => {
  const session = readFileSync('src/lib/session.ts', 'utf8');
  const auth = readFileSync('src/lib/auth.ts', 'utf8');
  assert.match(session, /if \(!user \|\| !user\.isActive \|\| !sessionRow\) return null;/);
  assert.match(auth, /if \(!owner\?\.isActive\) \{\s*throw new APIError\('UNAUTHORIZED'/);
});
