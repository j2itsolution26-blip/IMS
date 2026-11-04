import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AuditAction, PrismaClient } from '@prisma/client';

/**
 * The Audit & Activity Center against a real PostgreSQL database: every
 * category and severity filter returns exactly the entries the shared rules
 * classify that way, only the signed-in store's entries are ever returned,
 * and failed sign-ins are logged to the right store, capped, and numbered
 * once each even when they arrive together.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Refuses any host but localhost. Leaves its uniquely named rows in place
 * (audit_logs is append-only).
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('audit center (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run audit tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  let platform: PrismaClient;
  let storeClient: (storeId: string) => PrismaClient;
  let rules: typeof import('@/lib/audit-log');
  const run = randomBytes(4).toString('hex');
  const A = `it_auditA_${run}`;
  const B = `it_auditB_${run}`;

  const ENTRIES: [AuditAction, string, string, object?][] = [
    ['LOGIN', 'User', 'Signed in'],
    ['LOGIN_FAILED', 'User', 'Failed sign-in for @x', { attempt: 1 }],
    ['LOGIN_FAILED', 'User', '5 failed sign-ins for @x within 10 minutes', { attempt: 5 }],
    ['LOGOUT', 'User', 'Session revoked after 5 wrong unlock attempts on the lock screen'],
    ['UPDATE', 'User', 'Set own screen-lock PIN'],
    ['UPDATE', 'User', 'Reset password for x@x.ph'],
    ['UPDATE', 'User', 'Deactivated X (@x)', { isActive: { from: true, to: false } }],
    ['CREATE', 'User', 'Created user X'],
    ['UPDATE', 'Role', 'Set Cashier to 9 permission(s)'],
    ['SALE', 'Sale', 'Completed sale INV-1 for 95'],
    ['UPDATE', 'Sale', 'Voided sale INV-1: wrong'],
    ['RETURN', 'Return', 'Refund RET-1'],
    ['SHIFT_CLOSE', 'CashierShift', 'SH-1 closed — balanced'],
    ['SHIFT_REVIEW', 'CashierShift', 'Discrepancy flagged for owner review on SH-1: short'],
    ['SHIFT_REVIEW', 'CashierShift', 'Reviewed SH-1 (variance ₱5.00): ok'],
    ['SHIFT_ADJUSTMENT', 'CashierShift', 'Adjusted SH-1 by +₱5.00: recount'],
    ['CASH_MOVEMENT', 'CashierShift', 'SH-1 cash out ₱50.00 (Supplies): ice'],
    ['CASH_MOVEMENT', 'WalletTransaction', 'GCash cash-in'],
    ['INVENTORY_CHANGE', 'Inventory', 'Stock in ADJ-1: Rice +2.5 kg'],
    ['INVENTORY_CHANGE', 'Inventory', 'Stock adjustment ADJ-2 on 1 product(s): spoiled'],
    ['DELETE', 'Product', 'Deleted product Soap'],
    ['UPDATE', 'Product', 'Updated product Soap', { password: { from: 'a', to: 'b' } }],
    ['SETTINGS_CHANGE', 'Setting', 'Updated 1 setting(s): company.name'],
    ['SETTINGS_CHANGE', 'Setting', 'Updated 2 setting(s): company.name, sales.defaultTaxRate'],
    ['UPDATE', 'Branch', 'Archived branch Annex'],
    ['SUBSCRIPTION', 'Store', 'Plan changed'],
    ['EXPORT', 'DataExport', 'Exported products'],
    ['CREATE', 'Something', 'Created something'],
  ];

  async function seedStore(storeId: string, tag: string) {
    await platform.store.create({ data: { id: storeId, name: `Audit ${tag}`, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'ENTERPRISE' } });
    await platform.role.create({ data: { id: `role_${storeId}`, storeId, name: 'Owner', slug: 'owner' } });
    await platform.user.create({
      data: { id: `user_${storeId}`, storeId, name: `Owner ${tag}`, email: `${storeId.toLowerCase()}@it.test`, username: `own_${tag}_${run}`, roleId: `role_${storeId}` },
    });
    let n = 0;
    for (const [action, entity, summary, changes] of ENTRIES) {
      await platform.auditLog.create({
        data: { id: `${storeId}_e${n++}`, storeId, action, entity, summary, changes: changes ?? undefined, userId: `user_${storeId}` },
      });
    }
  }

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    ({ storeClient } = await import('@/lib/tenant/client'));
    rules = await import('@/lib/audit-log');
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);
    await seedStore(A, 'a');
    await seedStore(B, 'b');
  });

  after(async () => {
    await platform?.$disconnect();
  });

  async function ownEntries() {
    return storeClient(A).auditLog.findMany({ where: { id: { startsWith: `${A}_e` } } });
  }

  test('each category filter returns exactly what the rules classify as that category', async () => {
    const db = storeClient(A);
    const all = await ownEntries();
    assert.equal(all.length, ENTRIES.length);
    let covered = 0;
    for (const category of rules.AUDIT_CATEGORY_ORDER) {
      const found = await db.auditLog.findMany({ where: { AND: [{ id: { startsWith: `${A}_e` } }, rules.categoryWhere(category)] }, select: { id: true } });
      const expected = all.filter((e) => rules.classifyAudit(e).category === category).map((e) => e.id);
      assert.deepEqual(found.map((e) => e.id).sort(), expected.sort(), category);
      covered += found.length;
    }
    assert.equal(covered, ENTRIES.length, 'every entry is in exactly one category');
  });

  test('each severity filter returns exactly what the rules classify as that severity', async () => {
    const db = storeClient(A);
    const all = await ownEntries();
    for (const severity of rules.AUDIT_SEVERITY_ORDER) {
      const found = await db.auditLog.findMany({ where: { AND: [{ id: { startsWith: `${A}_e` } }, rules.severityWhere(severity)] }, select: { id: true } });
      const expected = all.filter((e) => rules.classifyAudit(e).severity === severity).map((e) => e.id);
      assert.deepEqual(found.map((e) => e.id).sort(), expected.sort(), severity);
      assert.ok(expected.length > 0, `${severity} is exercised`);
    }
  });

  test('a store sees only its own entries, whatever the filter', async () => {
    const db = storeClient(A);
    for (const category of rules.AUDIT_CATEGORY_ORDER) {
      const rows = await db.auditLog.findMany({ where: rules.categoryWhere(category), select: { storeId: true } });
      assert.ok(rows.every((r) => r.storeId === A), category);
    }
    assert.equal(await db.auditLog.findUnique({ where: { id: `${B}_e0` } }), null, "store B's entry is invisible to store A");
    assert.equal(await db.auditLog.count({ where: { user: { name: { contains: 'Owner b' } } } }), 0, 'search by another store’s staff finds nothing');
  });

  test('newest first, paged, with no row twice', async () => {
    const db = storeClient(A);
    const where = { id: { startsWith: `${A}_e` } };
    const page1 = await db.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10 });
    const page2 = await db.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 10, take: 10 });
    const ids = [...page1, ...page2].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    for (let i = 1; i < page1.length; i++) assert.ok(page1[i - 1].createdAt >= page1[i].createdAt);
  });

  test('the log stays append-only', async () => {
    await assert.rejects(() => platform.auditLog.update({ where: { id: `${A}_e0` }, data: { summary: 'edited' } }), /cannot be edited/);
    await assert.rejects(() => platform.auditLog.delete({ where: { id: `${A}_e0` } }), /cannot be deleted/);
  });

  test('failed sign-ins: own store, numbered once each, capped at five, unknown usernames ignored', async () => {
    const { recordFailedSignIn } = await import('@/lib/sign-in-audit');
    const username = `own_a_${run}`;
    const attempt = () => recordFailedSignIn({ method: 'username', identifier: ` ${username.toUpperCase()} `, ipAddress: '127.0.0.1', userAgent: 'test' });
    // Seven at once: the per-account lock keeps the numbering clean.
    await Promise.all(Array.from({ length: 7 }, attempt));
    const logged = await platform.auditLog.findMany({
      where: { action: 'LOGIN_FAILED', entityId: `user_${A}` },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(logged.length, 5);
    assert.ok(logged.every((row) => row.storeId === A && row.userId === null));
    const attempts = logged.map((row) => (row.changes as { attempt: number }).attempt).sort();
    assert.deepEqual(attempts, [1, 2, 3, 4, 5]);
    const last = logged.find((row) => (row.changes as { attempt: number }).attempt === 5)!;
    assert.equal(rules.classifyAudit(last).severity, 'critical');
    assert.doesNotMatch(JSON.stringify(logged), /password/i);

    await recordFailedSignIn({ method: 'username', identifier: `nobody_${run}`, ipAddress: null, userAgent: null });
    await recordFailedSignIn({ method: 'email', identifier: `nobody_${run}@it.test`, ipAddress: null, userAgent: null });
    assert.equal(await platform.auditLog.count({ where: { action: 'LOGIN_FAILED', summary: { contains: `nobody_${run}` } } }), 0);

    // By email, for store B: its own store, its own count.
    await recordFailedSignIn({ method: 'email', identifier: `${B}@IT.TEST`, ipAddress: null, userAgent: null });
    const b = await platform.auditLog.findMany({ where: { action: 'LOGIN_FAILED', entityId: `user_${B}` } });
    assert.equal(b.length, 1);
    assert.equal(b[0].storeId, B);
  });
}
