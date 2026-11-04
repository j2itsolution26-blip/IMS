import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AuditAction } from '@prisma/client';
import {
  AUDIT_ACTION_LABEL,
  CATEGORY_RULES,
  FAILED_SIGN_IN_MAX_LOGGED,
  MASKED,
  SECURITY_SUMMARY_PREFIXES,
  SENSITIVE_SETTING_KEYS,
  actionsMatchingSearch,
  auditWindowStart,
  changeRows,
  classifyAudit,
  isSensitiveKey,
  maskSensitive,
  parseAuditCategory,
  parseAuditSeverity,
  relatedLink,
} from '@/lib/audit-log';
import { failedSignInSummary } from '@/lib/sign-in-audit';
import { PLANS } from '@/lib/plans';
import { ALL_PERMISSIONS, ROUTE_PERMISSIONS, STORE_PERMISSION_KEYS, SYSTEM_ROLES, resolveRolePermissions } from '@/lib/permissions';

/**
 * The store activity log: the plan window, the permission that opens it, the
 * category and severity rules, masking, failed sign-ins, and the rule that
 * every store audit read applies the window on the server.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-11-01T00:00:00Z');
const visible = (days: number | null, ageDays: number) => {
  const start = auditWindowStart(days, NOW);
  return start === null || NOW.getTime() - ageDays * DAY >= start.getTime();
};

test('each plan sees exactly its audit history: Basic 90 days, Business 365, Enterprise all', () => {
  assert.equal(PLANS.BASIC.auditHistoryDays, 90);
  assert.equal(PLANS.BUSINESS.auditHistoryDays, 365);
  assert.equal(PLANS.ENTERPRISE.auditHistoryDays, null);

  assert.ok(visible(90, 89) && visible(90, 90));
  assert.ok(!visible(90, 91));
  assert.ok(visible(365, 364) && visible(365, 365));
  assert.ok(!visible(365, 366));
  assert.ok(visible(null, 5000));
  assert.equal(auditWindowStart(90, NOW)?.toISOString(), new Date(NOW.getTime() - 90 * DAY).toISOString());
});

const entry = (action: AuditAction, entity: string, summary: string, changes?: unknown) => classifyAudit({ action, entity, summary, changes });

test('every entry the code writes lands in the right category', () => {
  const cases: [AuditAction, string, string, string][] = [
    ['LOGIN', 'User', 'Signed in', 'security'],
    ['LOGIN_FAILED', 'User', 'Failed sign-in for @ana', 'security'],
    ['LOGOUT', 'User', 'Session revoked after 5 wrong unlock attempts on the lock screen', 'security'],
    ['UPDATE', 'User', 'Set own screen-lock PIN', 'security'],
    ['UPDATE', 'User', 'Added a passkey (Phone)', 'security'],
    ['UPDATE', 'User', 'Reset password for ana@x.ph', 'security'],
    ['UPDATE', 'User', 'Deactivated Ana (@ana)', 'staff'],
    ['CREATE', 'User', 'Created user Ana (@ana, ana@x.ph) with role Cashier', 'staff'],
    ['UPDATE', 'Role', 'Set Cashier to 9 permission(s)', 'staff'],
    ['SALE', 'Sale', 'Completed sale INV-000001 for 95', 'sales'],
    ['UPDATE', 'Sale', 'Voided sale INV-000001: wrong item', 'refunds'],
    ['RETURN', 'Return', 'Refund RET-000001', 'refunds'],
    ['SHIFT_CLOSE', 'CashierShift', 'SH-000001 closed — expected ₱1.00', 'shifts'],
    ['SHIFT_REVIEW', 'CashierShift', 'Discrepancy flagged for owner review on SH-000001: short', 'shifts'],
    ['CASH_MOVEMENT', 'CashierShift', 'SH-000001 cash out ₱50.00 (Supplies): ice', 'cash'],
    ['CASH_MOVEMENT', 'WalletTransaction', 'GCash cash-in', 'cash'],
    ['INVENTORY_CHANGE', 'Inventory', 'Stock in ADJ-000001: Rice +2.5 kg', 'inventory'],
    ['DELETE', 'Product', 'Deleted product Soap', 'inventory'],
    ['CREATE', 'Category', 'Added suggested categories: Rice and Grains', 'inventory'],
    ['SETTINGS_CHANGE', 'Setting', 'Updated 1 setting(s): company.name', 'settings'],
    ['UPDATE', 'Branch', 'Archived branch Annex', 'settings'],
    ['SUBSCRIPTION', 'Store', 'Plan changed', 'billing'],
    ['EXPORT', 'DataExport', 'Exported products', 'exports'],
    ['EXPORT', 'Report', 'Exported shifts report', 'exports'],
    ['CREATE', 'Something', 'Created something', 'other'],
  ];
  for (const [action, entity, summary, category] of cases) {
    assert.equal(entry(action, entity, summary).category, category, `${action} ${entity} "${summary}"`);
  }
});

test('severity is reserved for what warrants a look; routine work is never flagged', () => {
  const routine: [AuditAction, string, string][] = [
    ['LOGIN', 'User', 'Signed in'],
    ['SALE', 'Sale', 'Completed sale INV-000001 for 95'],
    ['SETTINGS_CHANGE', 'Setting', 'Updated 2 setting(s): company.name, pos.receiptFooter'],
    ['INVENTORY_CHANGE', 'Inventory', 'Stock in ADJ-000001: Rice +2.5 kg'],
    ['SHIFT_CLOSE', 'CashierShift', 'SH-000001 closed — balanced'],
    ['UPDATE', 'User', 'Set own screen-lock PIN'],
  ];
  for (const [action, entity, summary] of routine) assert.equal(entry(action, entity, summary).severity, 'normal', summary);

  const attention: [AuditAction, string, string][] = [
    ['UPDATE', 'Sale', 'Voided sale INV-000001: wrong item'],
    ['RETURN', 'Return', 'Refund RET-000001'],
    ['SHIFT_REVIEW', 'CashierShift', 'Discrepancy flagged for owner review on SH-000001: short ₱20.00'],
    ['UPDATE', 'User', 'Deactivated Ana (@ana)'],
    ['UPDATE', 'Role', 'Set Cashier to 9 permission(s)'],
    ['INVENTORY_CHANGE', 'Inventory', 'Stock adjustment ADJ-000002 on 1 product(s): spoiled'],
    ['SETTINGS_CHANGE', 'Setting', 'Updated 2 setting(s): company.name, sales.defaultTaxRate'],
  ];
  for (const [action, entity, summary] of attention) assert.equal(entry(action, entity, summary).severity, 'attention', summary);
  assert.equal(entry('SHIFT_REVIEW', 'CashierShift', 'Reviewed SH-000001 (variance ₱20.00): ok').severity, 'normal', 'a completed review is routine');

  assert.equal(entry('LOGIN_FAILED', 'User', 'Failed sign-in for @ana', { attempt: 1 }).severity, 'attention');
  assert.equal(entry('LOGIN_FAILED', 'User', 'x', { attempt: FAILED_SIGN_IN_MAX_LOGGED }).severity, 'critical');
  assert.equal(entry('LOGOUT', 'User', 'Session revoked after 5 wrong unlock attempts on the lock screen').severity, 'critical');
  assert.equal(entry('LOGOUT', 'User', 'Locked the screen').severity, 'normal');
});

test('the wording the rules match is the wording the code writes', () => {
  const sources = [
    'src/features/auth/lock-actions.ts',
    'src/features/auth/passkey-actions.ts',
    'src/lib/passkey-plugin.ts',
    'src/features/admin/actions.ts',
    'src/features/auth/password-change-actions.ts',
  ]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  for (const prefix of SECURITY_SUMMARY_PREFIXES) {
    assert.ok(sources.includes(`'${prefix}`) || sources.includes('`' + prefix), prefix);
  }
  const admin = readFileSync('src/features/admin/actions.ts', 'utf8');
  assert.ok(admin.includes('summary: `Updated ${changed.length} setting(s): ${changed.join(\', \')}`'), 'settings entries name keys, never values');
  const definitions = readFileSync('src/lib/settings-definitions.ts', 'utf8');
  for (const key of SENSITIVE_SETTING_KEYS) assert.ok(definitions.includes(`'${key}'`), key);
  assert.ok(readFileSync('src/server/services/shift-service.ts', 'utf8').includes('`Discrepancy flagged for owner review on'));
  assert.ok(readFileSync('src/server/services/stock-movement-service.ts', 'utf8').includes('`Stock adjustment ${reference}'));
  assert.match(readFileSync('src/server/services/sale-service.ts', 'utf8'), /action: 'UPDATE',\s+entity: 'Sale',[\s\S]{0,80}summary: `Voided sale/);
  assert.deepEqual(
    [...new Set(CATEGORY_RULES.map((r) => r.category))].sort(),
    ['billing', 'cash', 'exports', 'inventory', 'refunds', 'sales', 'security', 'settings', 'shifts', 'staff'],
  );
});

test('filters parse safely; old links still work; search finds activity by its label', () => {
  assert.equal(parseAuditCategory('security'), 'security');
  assert.equal(parseAuditCategory('cash'), 'cash');
  assert.equal(parseAuditCategory('toString'), null);
  assert.equal(parseAuditCategory(undefined), null);
  assert.equal(parseAuditSeverity('critical'), 'critical');
  assert.equal(parseAuditSeverity('constructor'), null);
  assert.deepEqual(actionsMatchingSearch('refund'), ['RETURN']);
  assert.ok(actionsMatchingSearch('failed').includes('LOGIN_FAILED'));
  assert.deepEqual(actionsMatchingSearch('re'), [], 'too short to mean an action');
  for (const label of Object.values(AUDIT_ACTION_LABEL)) assert.ok(label.length > 0);
});

test('secrets are masked at any depth, and only recorded details are shown', () => {
  for (const key of ['password', 'newPassword', 'pin', 'pinHash', 'newPin', 'secret', 'token', 'accessToken', 'otp', 'apiKey', 'gcashNumber', 'cardNumber', 'credentialId']) {
    assert.ok(isSensitiveKey(key), key);
  }
  for (const key of ['shipping', 'footprint', 'reason', 'attempt', 'reviewStatus', 'isActive', 'openingCash', 'name']) {
    assert.ok(!isSensitiveKey(key), key);
  }
  const masked = maskSensitive({ name: 'Ana', password: 'hunter2', nested: { pinHash: 'abc', list: [{ token: 't' }] } }) as {
    name: string;
    password: string;
    nested: { pinHash: string; list: { token: string }[] };
  };
  assert.equal(masked.password, MASKED);
  assert.equal(masked.nested.pinHash, MASKED);
  assert.equal(masked.nested.list[0].token, MASKED);
  assert.equal(masked.name, 'Ana');
  assert.doesNotMatch(JSON.stringify(masked), /hunter2|abc/);

  assert.deepEqual(changeRows(null), [], 'nothing recorded, nothing invented');
  assert.deepEqual(changeRows({ isActive: { from: true, to: false }, reason: 'left' }), [
    { field: 'isActive', from: true, to: false },
    { field: 'reason', value: 'left' },
  ]);
  assert.deepEqual(changeRows({ password: { from: 'a', to: 'b' } }), [{ field: 'password', value: MASKED }]);
});

test('entries link to the record they are about, when it has a page', () => {
  assert.deepEqual(relatedLink({ action: 'SALE', entity: 'Sale', entityId: 's1' }), { label: 'Open sale', href: '/sales/s1' });
  assert.deepEqual(relatedLink({ action: 'SHIFT_CLOSE', entity: 'CashierShift', entityId: 'sh1' }), { label: 'Open shift', href: '/shifts/sh1' });
  assert.equal(relatedLink({ action: 'DELETE', entity: 'Product', entityId: 'p1' }), null, 'a deleted product has no page');
  assert.equal(relatedLink({ action: 'LOGIN', entity: 'Unknown', entityId: null }), null);
});

test('failed sign-ins: logged after the response, only for refused credentials, capped per account, never the password', () => {
  const auth = readFileSync('src/lib/auth.ts', 'utf8');
  const hook = auth.slice(auth.indexOf('after: createAuthMiddleware'));
  assert.ok(hook.includes(`ctx.path === '/sign-in/username'`));
  assert.ok(hook.includes(`returned.status !== 'UNAUTHORIZED'`));
  assert.ok(hook.includes('after(task)'), 'written after the response');
  assert.doesNotMatch(hook.slice(0, hook.indexOf('plugins:')), /password/i);

  const module = readFileSync('src/lib/sign-in-audit.ts', 'utf8');
  assert.ok(module.includes('if (!user?.storeId) return;'), 'unknown usernames and platform accounts are not logged');
  assert.ok(module.includes('pg_advisory_xact_lock'));
  assert.ok(module.includes('if (logged >= FAILED_SIGN_IN_MAX_LOGGED) return;'));
  assert.ok(module.includes('userId: null'), 'the person typing is unknown');
  const code = module.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /password/i, 'no password is read or stored');

  assert.equal(failedSignInSummary('ana', 1, true), 'Failed sign-in for @ana');
  assert.equal(failedSignInSummary('ana', 2, false), 'Failed sign-in for @ana (account deactivated)');
  assert.match(failedSignInSummary('ana', FAILED_SIGN_IN_MAX_LOGGED, true), /^5 failed sign-ins for @ana within 10 minutes/);

  const sql = readFileSync('prisma/migrations/20261117090000_audit_failed_sign_in/migration.sql', 'utf8');
  const statements = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.equal(statements.trim(), `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGIN_FAILED';`);
});

test('audit.view: an owner permission, guarding the page, added by migration with the catalogue wording', () => {
  assert.ok(STORE_PERMISSION_KEYS.includes('audit.view'));
  const owner = SYSTEM_ROLES.find((role) => role.slug === 'owner')!;
  assert.ok(resolveRolePermissions(owner).includes('audit.view'));
  for (const slug of ['cashier', 'inventory-staff']) {
    assert.ok(!resolveRolePermissions(SYSTEM_ROLES.find((role) => role.slug === slug)!).includes('audit.view'), `${slug} must not see the log`);
  }
  assert.ok(ROUTE_PERMISSIONS.some((r) => r.prefix === '/settings/audit' && r.permission === 'audit.view'));
  // The audit route must be matched before the catch-all /settings guard.
  const order = ROUTE_PERMISSIONS.map((r) => r.prefix);
  assert.ok(order.indexOf('/settings/audit') < order.indexOf('/settings'));

  const sql = readFileSync('prisma/migrations/20261110090000_store_audit_view/migration.sql', 'utf8');
  const definition = ALL_PERMISSIONS.find((p) => p.key === 'audit.view');
  assert.ok(definition && sql.includes(`'audit.view', 'audit', 'view', '${definition.description}'`), definition?.description);
  assert.match(sql, /WHERE r\."slug" = 'owner' AND r\."storeId" IS NOT NULL/);
  const statements = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /\b(DELETE|DROP|TRUNCATE|UPDATE)\b/i, 'the migration only adds rows');
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

test('every store audit read applies the plan window on the server', () => {
  const page = readFileSync('src/app/(app)/settings/audit/page.tsx', 'utf8');
  assert.match(page, /requirePermission\('audit\.view'\)/);
  assert.doesNotMatch(page, /auditLog\./, 'the page reads through listStoreAudit, never the table directly');
  assert.match(page, /isStoreWideAuditViewer\(\)/, 'branch-limited accounts are refused');

  const queries = readFileSync('src/server/services/audit-queries.ts', 'utf8');
  assert.match(queries, /const conditions = rangeWhere\(window, filters\.from, filters\.to\)/);
  assert.match(queries, /const conditions: Prisma\.AuditLogWhereInput\[\] = \[window\]/);
  assert.doesNotMatch(queries, /auditLog\.(create|update|delete|upsert)/, 'read-only');
  // IP and device are read only for one opened entry, and shown only for sign-in and security entries.
  const list = queries.slice(queries.indexOf('export async function listStoreAudit'), queries.indexOf('export interface StoreAuditSummary'));
  assert.doesNotMatch(list, /ipAddress: true|userAgent: true/, 'the list never carries IP or browser details');
  assert.ok(queries.includes('ipAddress: security ? row.ipAddress : null'));
  assert.ok(queries.includes('where: { AND: [auditWindowWhere(ctx), { id }] }'), 'one entry is still limited to the plan window');
  const action = readFileSync('src/features/audit/actions.ts', 'utf8');
  assert.match(action, /await authorize\('audit\.view'\);\s+await assertStoreWideAuditViewer\(\);/);

  // Store pages that read audit entries: each one applies the window.
  for (const file of walk('src/app/(app)').filter((f) => !f.includes('system-admin'))) {
    const source = readFileSync(file, 'utf8');
    if (!/auditLog\.findMany/.test(source)) continue;
    assert.match(source, /auditWindowWhere\(|historyStart/, `${file} must apply the plan's audit window`);
  }
});
