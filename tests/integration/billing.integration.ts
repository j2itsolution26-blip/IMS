import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Subscription billing against a real PostgreSQL database: invoices priced
 * from the stored list, one open invoice per store even under concurrent
 * requests, payments pending until verified, verification applied exactly
 * once, revenue counting only verified money, expired trials owing nothing,
 * lapsed stores still able to pay, and owners confined to their own store.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Local databases only. Needs every migration applied (including
 * 20261029090000_billing) and bootstrap run. Writes its own prices and terms.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('billing (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run billing tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  const DAY = 86_400_000;
  const run = randomBytes(4).toString('hex');
  let seq = 0;
  let platform: PrismaClient;
  let subs: typeof import('@/server/platform/subscription-service');
  let billing: typeof import('@/server/platform/billing-service');
  let queries: typeof import('@/server/platform/billing-queries');
  let admin: { id: string; name: string };
  let termsVersion: number;

  async function newStore() {
    const tag = `${run}${++seq}`;
    const { storeId, ownerId } = await subs.createStore(admin, {
      storeName: `Billing ${tag}`,
      owner: { name: `Owner ${tag}`, username: `bill${tag}`, email: `bill${tag}@billing.test`, password: 'OwnerPass1!x' },
      allowSimilar: true,
    });
    return { storeId, owner: { id: ownerId, name: `Owner ${tag}`, storeId } };
  }

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    subs = await import('@/server/platform/subscription-service');
    billing = await import('@/server/platform/billing-service');
    queries = await import('@/server/platform/billing-queries');
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    const systemAdmin = await platform.user.findFirstOrThrow({ where: { role: { slug: 'system-admin' } }, select: { id: true, name: true } });
    admin = systemAdmin;
    await billing.setPlanPrice(admin, { plan: 'BASIC', interval: 'MONTHLY', amount: 499 });
    await billing.setPlanPrice(admin, { plan: 'BUSINESS', interval: 'ANNUAL', amount: 9990 });
    ({ version: termsVersion } = await billing
      .publishTerms(admin, { body: `Integration billing terms ${run}: pay by the due date; renewals are manual.` })
      .catch(async () => ({ version: (await platform.billingTerms.findFirstOrThrow({ orderBy: { version: 'desc' } })).version })));
  });

  after(async () => {
    await platform.$disconnect();
  });

  describe('billing', () => {
    test('a trial store has no invoice and owes nothing; expiring it creates none', async () => {
      const { storeId } = await newStore();
      await platform.store.update({ where: { id: storeId }, data: { trialEndsAt: new Date(Date.now() - 20 * DAY) } });
      assert.equal(await platform.invoice.count({ where: { storeId } }), 0);
      const rows = await queries.loadSubscriptionRows();
      const mine = rows.find((r) => r.storeId === storeId)!;
      assert.equal(mine.lifecycle, 'TRIAL_EXPIRED');
      assert.equal(mine.billing, null);
    });

    test('choosing a plan prices the invoice from the list and copies the accepted terms', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      const invoice = await platform.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      assert.equal(Number(invoice.amount), 499);
      assert.equal(invoice.storeId, storeId);
      assert.equal(invoice.termsVersion, termsVersion);
      assert.ok(invoice.termsBody.length > 0);
      assert.equal(invoice.status, 'OPEN');
    });

    test('stale terms or no acceptance are refused', async () => {
      const { owner } = await newStore();
      await assert.rejects(billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion: termsVersion + 99, acceptTerms: true }));
      await assert.rejects(billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: false }));
      await assert.rejects(billing.selectPlan(owner, { plan: 'ENTERPRISE', interval: 'MONTHLY', termsVersion, acceptTerms: true }), /not available/);
    });

    test('ten simultaneous plan choices leave exactly one open invoice', async () => {
      const { storeId, owner } = await newStore();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true })),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(await platform.invoice.count({ where: { storeId, status: 'OPEN' } }), 1);
    });

    test('a reported payment is pending, changes nothing, and is not revenue', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      const before = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `P${run}${seq}`, paidAt: new Date() });
      const payment = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id } });
      assert.equal(payment.status, 'PENDING');
      const after = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.equal(after.status, before.status);
      assert.equal(after.plan, before.plan);
      const metrics = await queries.billingMetrics({ from: new Date(Date.now() - DAY), to: new Date(Date.now() + DAY) });
      const verifiedHere = await platform.subscriptionPayment.count({ where: { storeId, status: 'VERIFIED' } });
      assert.equal(verifiedHere, 0);
      assert.ok(metrics.collected >= 0);
      await assert.rejects(
        billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `Q${run}${seq}`, paidAt: new Date() }),
        /already awaiting verification/,
      );
    });

    test('verifying twice at once applies the payment exactly once', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'BANK_TRANSFER', reference: `V${run}${seq}`, paidAt: new Date() });
      const results = await Promise.allSettled([billing.verifyPayment(admin, { paymentId: id }), billing.verifyPayment(admin, { paymentId: id })]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const [payment, invoice, store] = await Promise.all([
        platform.subscriptionPayment.findUniqueOrThrow({ where: { id } }),
        platform.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
        platform.store.findUniqueOrThrow({ where: { id: storeId } }),
      ]);
      assert.equal(payment.status, 'VERIFIED');
      assert.equal(invoice.status, 'PAID');
      assert.equal(store.status, 'ACTIVE');
      assert.equal(store.plan, 'BASIC');
      assert.equal(store.billingInterval, 'MONTHLY');
      assert.equal(store.currentPeriodEnd?.getTime(), invoice.periodEnd.getTime());
    });

    test('a rejected payment leaves the invoice open with the reason', async () => {
      const { owner } = await newStore();
      const { invoiceId } = await billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `R${run}${seq}`, paidAt: new Date() });
      await billing.rejectPayment(admin, { paymentId: id, reason: 'No transfer with this reference arrived.' });
      const [payment, invoice] = await Promise.all([
        platform.subscriptionPayment.findUniqueOrThrow({ where: { id } }),
        platform.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
      ]);
      assert.equal(payment.status, 'REJECTED');
      assert.equal(invoice.status, 'OPEN');
      await assert.rejects(billing.verifyPayment(admin, { paymentId: id }), /already been reviewed/);
    });

    test('the database refuses edits to an invoice and a second review of a payment', async () => {
      const { owner } = await newStore();
      const { invoiceId } = await billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      await assert.rejects(platform.invoice.update({ where: { id: invoiceId }, data: { amount: 1 } }), /cannot be edited/);
      await assert.rejects(platform.invoice.delete({ where: { id: invoiceId } }), /cannot be deleted/);
    });

    test('a lapsed, read-only store can still choose a plan and report a payment', async () => {
      const { storeId, owner } = await newStore();
      await platform.store.update({ where: { id: storeId }, data: { trialEndsAt: new Date(Date.now() - 30 * DAY) } });
      const { invoiceId } = await billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `L${run}${seq}`, paidAt: new Date() });
      assert.ok(id);
    });

    test('an owner cannot pay or withdraw another store\'s invoice', async () => {
      const a = await newStore();
      const b = await newStore();
      const { invoiceId } = await billing.selectPlan(a.owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      await assert.rejects(
        billing.submitPayment(b.owner, { invoiceId, method: 'GCASH', reference: `X${run}${seq}`, paidAt: new Date() }),
        /not found|Invoice/i,
      );
      await assert.rejects(billing.withdrawInvoice(b.owner, { invoiceId }), /not found|Invoice/i);
    });
  });
}
