import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { AUDIT_ACTION_LABEL, AUDIT_CATEGORIES, auditWindowStart, parseAuditCategory } from '@/lib/audit-log';
import { PLANS } from '@/lib/plans';
import { ALL_PERMISSIONS, ROUTE_PERMISSIONS, STORE_PERMISSION_KEYS, SYSTEM_ROLES, resolveRolePermissions } from '@/lib/permissions';

/**
 * The store activity log: the plan window, the permission that opens it, and
 * the rule that every store audit read applies the window on the server.
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

test('categories cover sales, voids, refunds, cash, stock, staff and billing; unknown filters are ignored', () => {
  assert.ok(AUDIT_CATEGORIES.sales.actions.includes('SALE') && AUDIT_CATEGORIES.sales.actions.includes('RETURN'));
  assert.ok(AUDIT_CATEGORIES.cash.actions.includes('CASH_MOVEMENT'));
  assert.ok(AUDIT_CATEGORIES.inventory.actions.includes('INVENTORY_CHANGE'));
  assert.ok(AUDIT_CATEGORIES.staff.entities.includes('User'));
  assert.ok(AUDIT_CATEGORIES.billing.actions.includes('PAYMENT'));
  assert.equal(parseAuditCategory('sales'), 'sales');
  assert.equal(parseAuditCategory('toString'), null);
  assert.equal(parseAuditCategory(undefined), null);
  for (const label of Object.values(AUDIT_ACTION_LABEL)) assert.ok(label.length > 0);
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

  const queries = readFileSync('src/server/services/audit-queries.ts', 'utf8');
  assert.match(queries, /const conditions: Prisma\.AuditLogWhereInput\[\] = \[window\]/);
  assert.doesNotMatch(queries, /auditLog\.(create|update|delete|upsert)/, 'read-only');
  assert.doesNotMatch(queries, /ipAddress: true|userAgent: true/, 'IP and browser details are not shown');

  // Store pages that read audit entries: each one applies the window.
  for (const file of walk('src/app/(app)').filter((f) => !f.includes('system-admin'))) {
    const source = readFileSync(file, 'utf8');
    if (!/auditLog\.findMany/.test(source)) continue;
    assert.match(source, /auditWindowWhere\(|historyStart/, `${file} must apply the plan's audit window`);
  }
});
