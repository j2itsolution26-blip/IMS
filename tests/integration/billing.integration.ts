import { PLANS } from '@/lib/plans';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
 * 20261101090000_payment_receipts) and bootstrap run. Writes its own prices,
 * terms and payment accounts. Receipts are recorded as rows only: the file
 * upload itself happens in the action, before the service is called.
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
  let review: typeof import('@/server/platform/payment-review-queries');
  let admin: { id: string; name: string };
  let termsVersion: number;

  /** A receipt as the action hands it to the service: already in the store's private folder. */
  function receipt(storeId: string) {
    return {
      storagePath: `receipts/${storeId}/${randomUUID()}.png`,
      originalName: 'gcash.png',
      mimeType: 'image/png' as const,
      sizeBytes: 2048,
      sha256: randomBytes(32).toString('hex'),
    };
  }

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
    review = await import('@/server/platform/payment-review-queries');
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    const systemAdmin = await platform.user.findFirstOrThrow({ where: { role: { slug: 'system-admin' } }, select: { id: true, name: true } });
    admin = systemAdmin;
    await billing.setPlanPrice(admin, { plan: 'BASIC', interval: 'MONTHLY', amount: 499 });
    await billing.setPlanPrice(admin, { plan: 'BUSINESS', interval: 'ANNUAL', amount: 9990 });
    ({ version: termsVersion } = await billing
      .publishTerms(admin, { body: `Integration billing terms ${run}: pay by the due date; renewals are manual.` })
      .catch(async () => ({ version: (await platform.billingTerms.findFirstOrThrow({ orderBy: { version: 'desc' } })).version })));
    // A GCash account with its QR code, and a bank account: checkout is open.
    await billing
      .setPaymentAccounts(admin, {
        accounts: [
          { id: 'it-gcash', kind: 'GCASH', bankName: null, accountName: 'Integration Test', accountNumber: '09171234567', note: null, enabled: true },
          { id: 'it-bank', kind: 'BANK_TRANSFER', bankName: 'BDO', accountName: 'Integration Test', accountNumber: '0012-3456-7890', note: null, enabled: true },
        ],
      })
      .catch(() => undefined);
    await billing
      .setPaymentAccountQr(admin, {
        accountId: 'it-gcash',
        image: { storagePath: `qr/${randomUUID()}.png`, originalName: 'qr.png', mimeType: 'image/png', sizeBytes: 1024, sha256: randomBytes(32).toString('hex') },
      })
      .catch(() => undefined);
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
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `P${run}${seq}`, paidAt: new Date(), receipt: receipt(owner.storeId) });
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
        billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `Q${run}${seq}`, paidAt: new Date(), receipt: receipt(owner.storeId) }),
        /already awaiting verification/,
      );
    });

    test('verifying twice at once applies the payment exactly once', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await billing.selectPlan(owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'BANK_TRANSFER', reference: `V${run}${seq}`, paidAt: new Date(), receipt: receipt(owner.storeId) });
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
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `R${run}${seq}`, paidAt: new Date(), receipt: receipt(owner.storeId) });
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
      const { id } = await billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference: `L${run}${seq}`, paidAt: new Date(), receipt: receipt(owner.storeId) });
      assert.ok(id);
    });

    test('an owner cannot pay or withdraw another store\'s invoice', async () => {
      const a = await newStore();
      const b = await newStore();
      const { invoiceId } = await billing.selectPlan(a.owner, { plan: 'BASIC', interval: 'MONTHLY', termsVersion, acceptTerms: true });
      await assert.rejects(
        billing.submitPayment(b.owner, { invoiceId, method: 'GCASH', reference: `X${run}${seq}`, paidAt: new Date(), receipt: receipt(b.owner.storeId) }),
        /not found|Invoice/i,
      );
      await assert.rejects(billing.withdrawInvoice(b.owner, { invoiceId }), /not found|Invoice/i);
    });
  });

  describe('GCash payment verification', () => {
    type O = { id: string; name: string; storeId: string };
    const pay = (owner: O, invoiceId: string, reference: string, now?: Date) =>
      billing.submitPayment(owner, { invoiceId, method: 'GCASH', reference, paidAt: now ?? new Date(), receipt: receipt(owner.storeId) }, now);
    const choose = (owner: O, plan: 'BASIC' | 'BUSINESS' = 'BASIC', now?: Date) =>
      billing.selectPlan(owner, { plan, interval: plan === 'BASIC' ? 'MONTHLY' : 'ANNUAL', termsVersion, acceptTerms: true }, now);

    test('only the store owner can choose a plan or pay; a staff account with billing access cannot', async () => {
      const { owner } = await newStore();
      const { invoiceId } = await choose(owner);
      const staff = { ...owner, id: `staff-${run}${seq}`, name: 'Staff' };
      await assert.rejects(choose(staff), /Only the store owner/);
      await assert.rejects(pay(staff, invoiceId, `S${run}${seq}`), /Only the store owner/);
      await assert.rejects(billing.withdrawInvoice(staff, { invoiceId }), /Only the store owner/);
    });

    test("a submission needs a receipt in the store's own folder", async () => {
      const a = await newStore();
      const b = await newStore();
      const { invoiceId } = await choose(a.owner);
      const base = { invoiceId, method: 'GCASH' as const, reference: `N${run}${seq}`, paidAt: new Date() };
      await assert.rejects(billing.submitPayment(a.owner, { ...base, receipt: undefined as never }), /receipt/i);
      await assert.rejects(billing.submitPayment(a.owner, { ...base, receipt: receipt(b.storeId) }), /receipt/i);
      await assert.rejects(
        billing.submitPayment(a.owner, { ...base, receipt: { ...receipt(a.storeId), storagePath: `receipts/${a.storeId}/../x.png` } }),
        /receipt/i,
      );
      assert.equal(await platform.subscriptionPayment.count({ where: { invoiceId } }), 0);
    });

    test('the database refuses an owner submission without a receipt, and receipts cannot be changed or deleted', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await choose(owner);
      const invoice = await platform.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      await assert.rejects(
        platform.subscriptionPayment.create({
          data: {
            storeId,
            invoiceId,
            status: 'PENDING',
            plan: 'BASIC',
            amount: invoice.amount,
            method: 'GCASH',
            reference: `D${run}${seq}`,
            paidAt: new Date(),
            months: 1,
            periodStart: invoice.periodStart,
            periodEnd: invoice.periodEnd,
            recordedById: owner.id,
          },
        }),
        /needs its receipt/,
      );
      const { id } = await pay(owner, invoiceId, `E${run}${seq}`);
      const row = await platform.subscriptionPaymentReceipt.findUniqueOrThrow({ where: { paymentId: id } });
      assert.equal(row.storeId, storeId);
      assert.equal(row.uploadedById, owner.id);
      await assert.rejects(platform.subscriptionPaymentReceipt.update({ where: { id: row.id }, data: { originalName: 'x.png' } }), /cannot be changed/);
      await assert.rejects(platform.subscriptionPaymentReceipt.delete({ where: { id: row.id } }), /cannot be changed/);
    });

    test("an owner can read only their own store's receipts", async () => {
      const a = await newStore();
      const b = await newStore();
      const { invoiceId } = await choose(a.owner);
      const { id } = await pay(a.owner, invoiceId, `G${run}${seq}`);
      const row = await platform.subscriptionPaymentReceipt.findUniqueOrThrow({ where: { paymentId: id } });
      assert.ok(await review.findReceiptForOwner(a.owner.id, row.id));
      assert.equal(await review.findReceiptForOwner(b.owner.id, row.id), null);
      assert.equal((await review.receiptIdsForOwner(b.owner.id, [id])).size, 0);
      assert.ok(await review.findReceiptForAdmin(row.id));
    });

    test('a rejected reference may be submitted again as corrected proof; a pending or verified one may not', async () => {
      const a = await newStore();
      const b = await newStore();
      const ref = `C${run}${seq}`;
      const { invoiceId } = await choose(a.owner);
      const first = await pay(a.owner, invoiceId, ref);
      // While pending, nobody else can report the same transfer.
      const other = await choose(b.owner);
      await assert.rejects(pay(b.owner, other.invoiceId, ref), /already been recorded|already used/);
      await billing.rejectPayment(admin, { paymentId: first.id, reason: 'The receipt image is unreadable.' });
      const second = await pay(a.owner, invoiceId, ref);
      assert.notEqual(second.id, first.id);
      // The rejected submission and its receipt are kept as evidence.
      const kept = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id: first.id }, include: { receipt: true } });
      assert.equal(kept.status, 'REJECTED');
      assert.ok(kept.receipt);
      await billing.verifyPayment(admin, { paymentId: second.id });
      await assert.rejects(pay(b.owner, other.invoiceId, ref), /already been recorded|already used/);
    });

    test('a rejected payment never activates a plan', async () => {
      const { storeId, owner } = await newStore();
      const before = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      const { invoiceId } = await choose(owner, 'BUSINESS');
      const { id } = await pay(owner, invoiceId, `J${run}${seq}`);
      await billing.rejectPayment(admin, { paymentId: id, reason: 'No such transfer in GCash.' });
      const after = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.deepEqual(
        { plan: after.plan, status: after.status, end: after.currentPeriodEnd, interval: after.billingInterval },
        { plan: before.plan, status: before.status, end: before.currentPeriodEnd, interval: before.billingInterval },
      );
      assert.equal((await platform.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, 'OPEN');
      const notice = await platform.notification.findFirst({ where: { storeId, type: 'PAYMENT_REJECTED' } });
      assert.match(notice?.body ?? '', /No such transfer/);
    });

    test('approval activates the exact plan and interval, applies its limits, and is audited and notified', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await choose(owner, 'BUSINESS');
      const { id } = await pay(owner, invoiceId, `A${run}${seq}`);
      assert.ok(await platform.notification.findFirst({ where: { storeId, type: 'PAYMENT_SUBMITTED' } }), 'the owner is told it was received');
      assert.ok(await platform.platformNotification.findUnique({ where: { dedupeKey: `payment:${id}:submitted` } }), 'the administrator is told');
      await billing.verifyPayment(admin, { paymentId: id });
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.equal(store.plan, 'BUSINESS');
      assert.equal(store.status, 'ACTIVE');
      assert.equal(store.billingInterval, 'ANNUAL');
      // The plan's own quotas, from the one configuration (Business: 5,000 products, 10 staff).
      assert.equal(store.productLimit, PLANS.BUSINESS.limits.products);
      assert.equal(store.staffLimit, PLANS.BUSINESS.limits.staff);
      const payment = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id } });
      assert.equal(payment.verifiedById, admin.id);
      assert.ok(payment.verifiedAt);
      assert.equal(store.currentPeriodEnd?.getTime(), payment.periodEnd.getTime());
      assert.ok(await platform.notification.findFirst({ where: { storeId, type: 'PAYMENT_VERIFIED' } }));
      const entries = await platform.auditLog.findMany({ where: { entity: 'SubscriptionPayment', entityId: id } });
      assert.ok(entries.some((entry) => entry.storeId === null && entry.userId === admin.id && /Verified/.test(entry.summary)), 'platform trail names the admin');
      assert.ok(entries.some((entry) => entry.storeId === storeId), 'the store trail has it too');
    });

    test('five simultaneous approvals extend the subscription exactly once', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await choose(owner);
      const { id } = await pay(owner, invoiceId, `K${run}${seq}`);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => billing.verifyPayment(admin, { paymentId: id })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const payment = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id } });
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.equal(store.currentPeriodEnd?.getTime(), payment.periodEnd.getTime());
      assert.equal(
        await platform.auditLog.count({ where: { entity: 'SubscriptionPayment', entityId: id, storeId: null, summary: { contains: 'Verified' } } }),
        1,
      );
    });

    test('a renewal extends the running paid period instead of resetting it', async () => {
      const { storeId, owner } = await newStore();
      const paidUntil = new Date(Date.now() + 10 * DAY);
      await platform.store.update({ where: { id: storeId }, data: { status: 'ACTIVE', plan: 'BASIC', currentPeriodEnd: paidUntil, trialEndsAt: null } });
      const { invoiceId } = await choose(owner);
      const { id } = await pay(owner, invoiceId, `W${run}${seq}`);
      await billing.verifyPayment(admin, { paymentId: id });
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      const { addMonths } = await import('@/lib/subscription');
      assert.equal(store.currentPeriodEnd?.getTime(), addMonths(paidUntil, 1).getTime());
      const payment = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id } });
      assert.equal(payment.periodStart.getTime(), paidUntil.getTime());
    });

    test('a lapsed store is paid from the approval, so a slow review costs it no days', async () => {
      const { storeId, owner } = await newStore();
      await platform.store.update({ where: { id: storeId }, data: { trialEndsAt: new Date(Date.now() - 30 * DAY) } });
      const { invoiceId } = await choose(owner);
      const { id } = await pay(owner, invoiceId, `Y${run}${seq}`);
      const approvedAt = new Date(Date.now() + 2 * DAY);
      await billing.verifyPayment(admin, { paymentId: id }, approvedAt);
      const payment = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id } });
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      const { addMonths } = await import('@/lib/subscription');
      assert.equal(payment.periodStart.getTime(), approvedAt.getTime());
      assert.equal(store.currentPeriodEnd?.getTime(), addMonths(approvedAt, 1).getTime());
    });

    test('an expired invoice takes no submission; the owner withdraws it and chooses again', async () => {
      const { owner } = await newStore();
      const { invoiceId } = await choose(owner);
      const invoice = await platform.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const late = new Date(invoice.dueAt.getTime() + 8 * DAY);
      await assert.rejects(pay(owner, invoiceId, `Z${run}${seq}`, late), /expired/);
      await billing.withdrawInvoice(owner, { invoiceId });
      assert.ok((await choose(owner)).invoiceId);
    });

    test('a failed approval leaves everything as it was', async () => {
      const { storeId, owner } = await newStore();
      const { invoiceId } = await choose(owner);
      const { id } = await pay(owner, invoiceId, `F${run}${seq}`);
      await platform.store.update({ where: { id: storeId }, data: { status: 'SUSPENDED' } });
      const before = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      await assert.rejects(billing.verifyPayment(admin, { paymentId: id }), /suspended/);
      const [payment, invoice, after] = await Promise.all([
        platform.subscriptionPayment.findUniqueOrThrow({ where: { id } }),
        platform.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
        platform.store.findUniqueOrThrow({ where: { id: storeId } }),
      ]);
      assert.equal(payment.status, 'PENDING');
      assert.equal(invoice.status, 'OPEN');
      assert.deepEqual(
        { plan: after.plan, status: after.status, end: after.currentPeriodEnd },
        { plan: before.plan, status: before.status, end: before.currentPeriodEnd },
      );
    });

    test('the queue counts and lists submissions by status', async () => {
      const { owner } = await newStore();
      const { invoiceId } = await choose(owner);
      const ref = `QQ${run}${seq}`;
      const { id } = await pay(owner, invoiceId, ref);
      assert.ok((await review.pendingPaymentCount()) >= 1);
      const { rows } = await review.listPaymentRequests({ status: 'PENDING', plan: null, q: ref, page: 1, pageSize: 20 });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, id);
      assert.ok(rows[0].receiptId);
      const detail = await review.getPaymentReview(id);
      assert.equal(detail?.invoice?.id, invoiceId);
      assert.equal(detail?.status, 'PENDING');
    });

    test('with no usable payment account, checkout is closed', async () => {
      const { owner } = await newStore();
      const { invoiceId } = await choose(owner);
      const saved = (await billing.getBillingConfig()).paymentAccounts;
      // Hide every account; QR codes stay stored with their accounts.
      await billing.setPaymentAccounts(admin, { accounts: saved.map((account) => ({ ...account, enabled: false })) });
      try {
        await assert.rejects(pay(owner, invoiceId, `O${run}${seq}`), /not been set up/);
      } finally {
        await billing.setPaymentAccounts(admin, { accounts: saved });
      }
      assert.ok((await pay(owner, invoiceId, `OO${run}${seq}`)).id);
    });
  });
}
