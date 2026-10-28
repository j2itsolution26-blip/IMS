import 'server-only';

import { randomBytes } from 'node:crypto';
import { Prisma, type BillingInterval, type StorePlan, type SubscriptionPaymentMethod } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { getRequestContext } from '@/lib/session';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { PLANS } from '@/lib/plans';
import { INTERVAL_LABEL, INTERVAL_MONTHS, formatInvoiceNumber, invoiceExpiresAt, invoicePeriod, isInvoiceExpired } from '@/lib/billing';
import { PAYMENT_METHOD_LABEL, normalizeReference } from '@/lib/subscription';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  keepStoredQrPaths,
  parseStoredPaymentAccounts,
  reportableMethods,
  validatePaymentAccounts,
  type PaymentAccount,
} from '@/lib/payment-accounts';
import { isQrPath, isReceiptPathOf } from '@/lib/billing-files';
import type { StoredImage } from '@/server/platform/billing-storage';
import { syncLimits } from '@/server/platform/store-setup';
import { TX, audit, iso, lockStore, snapshot, type Actor, type Tx } from '@/server/platform/subscription-service';
import { raisePlatformNotification, type NewPlatformNotification } from '@/server/platform/platform-notification-service';
import { platformNotificationKey } from '@/lib/notifications';

/**
 * Subscription billing: the platform's price list, terms and payment
 * instructions; an owner choosing a plan (an invoice) and submitting a payment
 * reference; the administrator verifying or rejecting it.
 *
 * Callers authorise first — `billing.manage` for owners (their own store
 * only, taken from the session, never the request) and `platform.manage` for
 * the administrator. Amounts always come from the stored price list, never
 * from the browser. Every change runs in one transaction that locks the
 * store's row, and is audited without any payment credentials.
 *
 * Owner writes go through the platform client on purpose: a store whose
 * trial has lapsed is read-only through its own client, yet must still be
 * able to choose a plan and report a payment. Only these billing rows are
 * written that way, always for the signed-in owner's own store.
 */

export const PAYMENT_INSTRUCTIONS_KEY = 'billing.paymentInstructions';
/** The GCash and bank accounts owners pay into, as validated JSON (see lib/payment-accounts). */
export const PAYMENT_ACCOUNTS_KEY = 'billing.paymentAccounts';

const money = (amount: Prisma.Decimal | number) => formatCurrency(Number(amount), 'PHP');

// --- Configuration (platform administrator) -----------------------------------

export interface BillingConfig {
  prices: { plan: StorePlan; interval: BillingInterval; amount: number; currency: string }[];
  terms: { version: number; body: string; createdAt: Date } | null;
  paymentInstructions: string | null;
  /** Every listed account, enabled or not. Owners must only be shown the enabled ones. */
  paymentAccounts: PaymentAccount[];
}

/** Everything an owner needs to choose a plan. Missing pieces stay null or empty — nothing is assumed. */
export async function getBillingConfig(): Promise<BillingConfig> {
  const [prices, terms, settings] = await Promise.all([
    platformPrisma.planPrice.findMany({ select: { plan: true, interval: true, amount: true, currency: true } }),
    platformPrisma.billingTerms.findFirst({ orderBy: { version: 'desc' }, select: { version: true, body: true, createdAt: true } }),
    platformPrisma.platformSetting.findMany({
      where: { key: { in: [PAYMENT_INSTRUCTIONS_KEY, PAYMENT_ACCOUNTS_KEY] } },
      select: { key: true, value: true },
    }),
  ]);
  const setting = (key: string) => settings.find((row) => row.key === key)?.value ?? null;
  return {
    prices: prices.map((price) => ({ ...price, amount: Number(price.amount) })),
    terms,
    paymentInstructions: setting(PAYMENT_INSTRUCTIONS_KEY)?.trim() || null,
    paymentAccounts: parseStoredPaymentAccounts(setting(PAYMENT_ACCOUNTS_KEY)),
  };
}

async function platformAudit(tx: Tx, actor: Actor, summary: string, changes: Record<string, unknown>) {
  const { ipAddress, userAgent } = await getRequestContext().catch(() => ({ ipAddress: null, userAgent: null }));
  await tx.auditLog.create({
    data: {
      storeId: null,
      userId: actor.id,
      action: 'SETTINGS_CHANGE',
      entity: 'Billing',
      summary,
      changes: changes as Prisma.InputJsonValue,
      ipAddress,
      userAgent,
    },
  });
}

/** Sets (or, with null, removes) one plan's price for one interval. Issued invoices keep their own amount. */
export async function setPlanPrice(
  actor: Actor,
  input: { plan: StorePlan; interval: BillingInterval; amount: number | null },
): Promise<void> {
  if (input.amount !== null && (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000)) {
    throw new ValidationError('Enter a price above zero.', { amount: ['Enter a price above zero.'] });
  }
  await platformPrisma.$transaction(async (tx) => {
    const before = await tx.planPrice.findUnique({ where: { plan_interval: { plan: input.plan, interval: input.interval } } });
    if (input.amount === null) {
      if (before) await tx.planPrice.delete({ where: { id: before.id } });
    } else {
      const amount = new Prisma.Decimal(input.amount.toFixed(2));
      await tx.planPrice.upsert({
        where: { plan_interval: { plan: input.plan, interval: input.interval } },
        create: { plan: input.plan, interval: input.interval, amount, updatedById: actor.id },
        update: { amount, updatedById: actor.id },
      });
    }
    const label = `${PLANS[input.plan].name} ${INTERVAL_LABEL[input.interval].toLowerCase()}`;
    await platformAudit(
      tx,
      actor,
      input.amount === null ? `Removed the ${label} price` : `Set the ${label} price to ${money(input.amount)}`,
      { plan: input.plan, interval: input.interval, from: before ? Number(before.amount) : null, to: input.amount },
    );
  }, TX);
}

/** Publishes a new version of the billing terms. Earlier versions, and invoices that quote them, are untouched. */
export async function publishTerms(actor: Actor, input: { body: string }): Promise<{ version: number }> {
  const body = input.body.trim();
  if (body.length < 20) throw new ValidationError('Write the terms in full.', { body: ['Write the terms in full.'] });
  if (body.length > 20_000) throw new ValidationError('Keep the terms under 20,000 characters.', { body: ['Too long.'] });
  return platformPrisma.$transaction(async (tx) => {
    const latest = await tx.billingTerms.findFirst({ orderBy: { version: 'desc' }, select: { version: true, body: true } });
    if (latest?.body === body) throw new ConflictError('These terms are already the current version.');
    const version = (latest?.version ?? 0) + 1;
    await tx.billingTerms.create({ data: { version, body, createdById: actor.id } });
    await platformAudit(tx, actor, `Published billing terms version ${version}`, { version });
    return { version };
  }, TX);
}

/** The payment instructions owners see on an open invoice (GCash number, bank details). */
export async function setPaymentInstructions(actor: Actor, input: { value: string }): Promise<void> {
  const value = input.value.trim();
  if (value.length > 4_000) throw new ValidationError('Keep the instructions under 4,000 characters.', { value: ['Too long.'] });
  await platformPrisma.$transaction(async (tx) => {
    await tx.platformSetting.upsert({
      where: { key: PAYMENT_INSTRUCTIONS_KEY },
      create: { key: PAYMENT_INSTRUCTIONS_KEY, value, updatedById: actor.id },
      update: { value, updatedById: actor.id },
    });
    await platformAudit(tx, actor, value ? 'Updated the payment instructions' : 'Cleared the payment instructions', {});
  }, TX);
}

/** Serialises saves of the accounts list, so a QR upload and a list save never overwrite each other. */
async function lockAccountsSetting(tx: Tx) {
  await tx.$queryRaw`SELECT "key" FROM "platform_settings" WHERE "key" = ${PAYMENT_ACCOUNTS_KEY} FOR UPDATE`;
}

/**
 * Replaces the list of accounts owners pay into. The whole list is validated
 * again here, whatever the form checked. The audit entry names each account
 * by kind and the last four digits only.
 */
export async function setPaymentAccounts(
  actor: Actor,
  input: { accounts: unknown },
): Promise<{ count: number; removedQrPaths: string[] }> {
  const result = validatePaymentAccounts(input.accounts);
  if (!result.ok) {
    const fieldErrors = Object.fromEntries(Object.entries(result.errors).map(([key, message]) => [`accounts.${key}`, [message]]));
    throw new ValidationError(result.errors.list ?? 'Please correct the highlighted fields.', fieldErrors);
  }
  let accounts = result.accounts;
  let removedQrPaths: string[] = [];
  await platformPrisma.$transaction(async (tx) => {
    await lockAccountsSetting(tx);
    const before = await tx.platformSetting.findUnique({ where: { key: PAYMENT_ACCOUNTS_KEY }, select: { value: true } });
    const stored = parseStoredPaymentAccounts(before?.value);
    // QR codes are changed only by setPaymentAccountQr; the form's value is never used.
    accounts = keepStoredQrPaths(result.accounts, stored);
    const kept = new Set(accounts.map((account) => account.qrPath).filter(Boolean));
    removedQrPaths = stored.map((account) => account.qrPath).filter((path): path is string => path !== null && !kept.has(path));
    const value = JSON.stringify(accounts);
    if ((before?.value ?? '[]') === value) throw new ConflictError('Nothing changed.');
    await tx.platformSetting.upsert({
      where: { key: PAYMENT_ACCOUNTS_KEY },
      create: { key: PAYMENT_ACCOUNTS_KEY, value, updatedById: actor.id },
      update: { value, updatedById: actor.id },
    });
    const describe = (list: PaymentAccount[]) =>
      list.map((account) => `${PAYMENT_METHOD_LABEL[account.kind]} ••••${account.accountNumber.replace(/\D/g, '').slice(-4)}${account.enabled ? '' : ' (hidden)'}`);
    await platformAudit(tx, actor, `Updated the payment accounts (${accounts.filter((account) => account.enabled).length} shown to owners)`, {
      before: describe(parseStoredPaymentAccounts(before?.value)),
      after: describe(accounts),
    });
  }, TX);
  return { count: accounts.length, removedQrPaths };
}

/**
 * Sets (or, with null, removes) the QR code image of one GCash account. The
 * image was already checked and uploaded by the caller; its path must be a
 * QR path. Returns the path it replaced, for the caller to delete once this
 * has committed.
 */
export async function setPaymentAccountQr(
  actor: Actor,
  input: { accountId: string; image: StoredImage | null },
): Promise<{ replacedPath: string | null }> {
  if (input.image && !isQrPath(input.image.storagePath)) throw new ValidationError('That is not a QR code upload.', { qr: ['Upload the image again.'] });
  return platformPrisma.$transaction(async (tx) => {
    await lockAccountsSetting(tx);
    const row = await tx.platformSetting.findUnique({ where: { key: PAYMENT_ACCOUNTS_KEY }, select: { value: true } });
    const accounts = parseStoredPaymentAccounts(row?.value);
    const account = accounts.find((item) => item.id === input.accountId);
    if (!account) throw new NotFoundError('Payment account');
    if (account.kind !== 'GCASH') throw new ConflictError('Only a GCash account has a QR code.');
    const qrPath = input.image?.storagePath ?? null;
    if (account.qrPath === qrPath) throw new ConflictError('Nothing changed.');

    const next = accounts.map((item) => (item.id === account.id ? { ...item, qrPath } : item));
    await tx.platformSetting.upsert({
      where: { key: PAYMENT_ACCOUNTS_KEY },
      create: { key: PAYMENT_ACCOUNTS_KEY, value: JSON.stringify(next), updatedById: actor.id },
      update: { value: JSON.stringify(next), updatedById: actor.id },
    });
    const last4 = account.accountNumber.slice(-4);
    await platformAudit(
      tx,
      actor,
      qrPath ? `${account.qrPath ? 'Replaced' : 'Uploaded'} the QR code of GCash ••••${last4}` : `Removed the QR code of GCash ••••${last4}`,
      { account: `GCASH ••••${last4}`, image: input.image ? { type: input.image.mimeType, size: input.image.sizeBytes, sha256: input.image.sha256 } : null },
    );
    return { replacedPath: account.qrPath };
  }, TX);
}

// --- Owner: choose a plan, submit a payment ------------------------------------

export interface Owner {
  id: string;
  name: string;
  storeId: string;
}

async function ownerAudit(
  tx: Tx,
  owner: Owner,
  store: { id: string; name: string },
  entry: { action: 'SUBSCRIPTION' | 'PAYMENT'; entity: string; entityId: string; summary: string; changes: Record<string, unknown> },
) {
  const { ipAddress, userAgent } = await getRequestContext().catch(() => ({ ipAddress: null, userAgent: null }));
  const base = { action: entry.action, entity: entry.entity, entityId: entry.entityId, ipAddress, userAgent };
  await tx.auditLog.createMany({
    data: [
      { ...base, storeId: store.id, userId: owner.id, summary: entry.summary, changes: entry.changes as Prisma.InputJsonValue },
      {
        ...base,
        storeId: null,
        userId: null,
        summary: `${store.name}: ${entry.summary} (by the owner, ${owner.name})`,
        changes: { ...entry.changes, storeId: store.id, ownerId: owner.id } as Prisma.InputJsonValue,
      },
    ],
  });
}

async function notifyAdmin(tx: Tx, item: NewPlatformNotification, readBy?: string) {
  await raisePlatformNotification(item, { db: tx, readBy });
}

async function notifyStore(
  tx: Tx,
  storeId: string,
  item: {
    type: 'INVOICE_CREATED' | 'PAYMENT_SUBMITTED' | 'PAYMENT_VERIFIED' | 'PAYMENT_REJECTED' | 'BILLING_REMINDER';
    title: string;
    body: string;
    dedupeKey: string;
  },
) {
  await tx.notification.createMany({
    data: [{ storeId, type: item.type, title: item.title, body: item.body, href: '/settings/subscription', dedupeKey: item.dedupeKey }],
    skipDuplicates: true,
  });
}

/** Whether the account is the owner of the store (not merely a member with billing permission). */
export async function isStoreOwner(userId: string, storeId: string): Promise<boolean> {
  const store = await platformPrisma.store.findUnique({ where: { id: storeId }, select: { ownerId: true } });
  return store?.ownerId === userId;
}

/**
 * Locks the owner's store and confirms the caller is its owner account. Only
 * the owner chooses plans and pays, whatever billing permission a staff role
 * was given; staff may still view billing.
 */
async function lockOwnedStore(tx: Tx, owner: Owner) {
  const store = await lockStore(tx, owner.storeId);
  const row = await tx.store.findUnique({ where: { id: store.id }, select: { ownerId: true, isDemo: true } });
  if (!row?.ownerId || row.ownerId !== owner.id) {
    throw new ForbiddenError('Only the store owner can choose a plan or submit a payment.');
  }
  // A demo store is never billed: no plan choice, invoice or payment.
  if (row.isDemo) throw new ConflictError('This is a demo store. Demo stores are not billed.');
  return store;
}

const isOpenInvoiceConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  JSON.stringify(error.meta ?? {}).includes('invoices_one_open_per_store');

/**
 * The owner chooses a paid plan and accepts the current billing terms,
 * creating the one open invoice for their store. Nothing is charged; it is an
 * obligation the owner agreed to, priced from the stored price list.
 */
export async function selectPlan(
  owner: Owner,
  input: { plan: StorePlan; interval: BillingInterval; termsVersion: number; acceptTerms: boolean },
  now = new Date(),
): Promise<{ invoiceId: string; number: string }> {
  if (input.acceptTerms !== true) {
    throw new ValidationError('Accept the billing terms to choose a plan.', { acceptTerms: ['Required.'] });
  }
  try {
    return await platformPrisma.$transaction(async (tx) => {
      const store = await lockOwnedStore(tx, owner);
      if (store.status === 'SUSPENDED') {
        throw new ConflictError('This store is suspended. Contact the platform administrator.');
      }
      const price = await tx.planPrice.findUnique({ where: { plan_interval: { plan: input.plan, interval: input.interval } } });
      if (!price) throw new ConflictError('That plan is not available for that billing period.');
      const terms = await tx.billingTerms.findFirst({ orderBy: { version: 'desc' } });
      if (!terms) throw new ConflictError('Billing terms have not been published yet, so plans cannot be chosen.');
      if (terms.version !== input.termsVersion) {
        throw new ConflictError('The billing terms were updated. Review the current terms and accept them again.');
      }

      const period = invoicePeriod({ subscription: store, interval: input.interval, now });
      const number = formatInvoiceNumber(now, randomBytes(3).toString('hex'));
      const invoice = await tx.invoice.create({
        data: {
          number,
          storeId: store.id,
          plan: input.plan,
          interval: input.interval,
          amount: price.amount,
          currency: price.currency,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          dueAt: period.dueAt,
          termsVersion: terms.version,
          termsBody: terms.body,
          acceptedById: owner.id,
          acceptedAt: now,
        },
        select: { id: true, number: true },
      });

      const summary = `Chose ${PLANS[input.plan].name} (${INTERVAL_LABEL[input.interval].toLowerCase()}) at ${money(price.amount)}, accepting billing terms v${terms.version}; invoice ${number} due ${formatDate(period.dueAt)}`;
      await ownerAudit(tx, owner, store, {
        action: 'SUBSCRIPTION',
        entity: 'Invoice',
        entityId: invoice.id,
        summary,
        changes: {
          plan: input.plan,
          interval: input.interval,
          amount: Number(price.amount),
          termsVersion: terms.version,
          periodStart: iso(period.periodStart),
          periodEnd: iso(period.periodEnd),
          dueAt: iso(period.dueAt),
        },
      });
      await notifyStore(tx, store.id, {
        type: 'INVOICE_CREATED',
        title: `Invoice ${number} issued`,
        body: `${money(price.amount)} for ${PLANS[input.plan].name}, due ${formatDate(period.dueAt)}.`,
        dedupeKey: `invoice:${invoice.id}:created`,
      });
      await notifyAdmin(tx, {
        kind: 'PLAN_SELECTED',
        title: `${store.name} chose ${PLANS[input.plan].name}`,
        body: `Invoice ${number}: ${money(price.amount)} ${INTERVAL_LABEL[input.interval].toLowerCase()}, due ${formatDate(period.dueAt)}.`,
        href: `/system-admin/stores/${store.id}`,
        storeId: store.id,
        dedupeKey: `invoice:${invoice.id}:created`,
      });
      return { invoiceId: invoice.id, number: invoice.number };
    }, TX);
  } catch (error) {
    if (isOpenInvoiceConflict(error)) {
      throw new ConflictError('Your store already has an open invoice. Pay it or withdraw it first.');
    }
    throw error;
  }
}

/** The owner withdraws an unpaid plan choice before paying. Refused once a payment is awaiting review. */
export async function withdrawInvoice(owner: Owner, input: { invoiceId: string }, now = new Date()): Promise<void> {
  await platformPrisma.$transaction(async (tx) => {
    const store = await lockOwnedStore(tx, owner);
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, storeId: store.id },
      select: { id: true, number: true, status: true, payments: { where: { status: 'PENDING' }, select: { id: true } } },
    });
    if (!invoice) throw new NotFoundError('Invoice');
    if (invoice.status !== 'OPEN') throw new ConflictError('This invoice is already closed.');
    if (invoice.payments.length > 0) {
      throw new ConflictError('A payment for this invoice is awaiting verification, so it cannot be withdrawn.');
    }
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'VOID', voidedAt: now, voidedById: owner.id, voidReason: 'Withdrawn by the owner before payment' },
    });
    await ownerAudit(tx, owner, store, {
      action: 'SUBSCRIPTION',
      entity: 'Invoice',
      entityId: invoice.id,
      summary: `Withdrew the plan choice; invoice ${invoice.number} voided before payment`,
      changes: { invoice: invoice.number },
    });
  }, TX);
}

export interface PaymentSubmission {
  invoiceId: string;
  method: SubscriptionPaymentMethod;
  reference: string;
  paidAt: Date;
  notes?: string;
  /** The proof of payment, already checked and uploaded into this store's receipt folder by the caller. */
  receipt: StoredImage;
}

const isReferenceConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  /reference/i.test(JSON.stringify(error.meta ?? {}));

/**
 * The owner reports a payment against their open invoice, with the receipt
 * as proof. It waits as PENDING until the administrator checks the money
 * arrived in the receiving account; nothing about the subscription changes
 * until then. The receipt row is written in the same transaction, and the
 * database refuses a submission without one.
 */
export async function submitPayment(owner: Owner, input: PaymentSubmission, now = new Date()): Promise<{ id: string }> {
  const reference = normalizeReference(input.reference);
  if (!reference) throw new ValidationError('Enter the payment reference.', { reference: ['Enter the reference number.'] });
  if (Number.isNaN(input.paidAt.getTime()) || input.paidAt.getTime() > now.getTime() + 10 * 60_000) {
    throw new ValidationError('Use the date you paid.', { paidAt: ['The payment date cannot be in the future.'] });
  }
  if (!input.receipt || !isReceiptPathOf(input.receipt.storagePath, owner.storeId)) {
    throw new ValidationError('Attach your payment receipt.', { receipt: ['Attach a screenshot of your GCash receipt.'] });
  }
  try {
    return await platformPrisma.$transaction(async (tx) => {
      const store = await lockOwnedStore(tx, owner);
      if (store.status === 'SUSPENDED') {
        throw new ConflictError('This store is suspended. Contact the platform administrator.');
      }
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, storeId: store.id },
        select: {
          id: true, number: true, status: true, plan: true, interval: true, amount: true, currency: true,
          periodStart: true, periodEnd: true, dueAt: true,
          payments: { where: { status: 'PENDING' }, select: { id: true } },
        },
      });
      if (!invoice) throw new NotFoundError('Invoice');
      if (invoice.status !== 'OPEN') throw new ConflictError('This invoice is already closed.');
      if (isInvoiceExpired(invoice, now)) {
        throw new ConflictError(
          `This invoice expired on ${formatDate(invoiceExpiresAt(invoice.dueAt))}. Withdraw it and choose your plan again for a new invoice.`,
        );
      }
      // Only the methods of accounts owners can actually pay into; none while nothing is set up.
      const accountsRow = await tx.platformSetting.findUnique({ where: { key: PAYMENT_ACCOUNTS_KEY }, select: { value: true } });
      const methods = reportableMethods(parseStoredPaymentAccounts(accountsRow?.value));
      if (methods.length === 0) {
        throw new ConflictError('Payments cannot be accepted yet: the payment details have not been set up. Please contact support.');
      }
      if (!methods.includes(input.method)) {
        throw new ValidationError('That payment method is not accepted. Pay to one of the listed accounts.', {
          method: ['Choose one of the listed payment methods.'],
        });
      }
      if (invoice.payments.length > 0) throw new ConflictError('A payment for this invoice is already awaiting verification.');

      const payment = await tx.subscriptionPayment.create({
        data: {
          storeId: store.id,
          invoiceId: invoice.id,
          status: 'PENDING',
          plan: invoice.plan,
          amount: invoice.amount,
          currency: invoice.currency,
          method: input.method,
          reference,
          paidAt: input.paidAt,
          months: INTERVAL_MONTHS[invoice.interval],
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          notes: input.notes?.trim().slice(0, 500) || null,
          recordedById: owner.id,
        },
        select: { id: true },
      });
      await tx.subscriptionPaymentReceipt.create({
        data: {
          paymentId: payment.id,
          storeId: store.id,
          storagePath: input.receipt.storagePath,
          originalName: input.receipt.originalName,
          mimeType: input.receipt.mimeType,
          sizeBytes: input.receipt.sizeBytes,
          sha256: input.receipt.sha256,
          uploadedById: owner.id,
        },
      });

      // The reference is a transfer identifier, not a credential; it is shown
      // to the administrator to find the money, as for manual payments.
      const summary = `Submitted a ${PAYMENT_METHOD_LABEL[input.method]} payment of ${money(invoice.amount)} for invoice ${invoice.number} with a receipt; awaiting verification`;
      await ownerAudit(tx, owner, store, {
        action: 'PAYMENT',
        entity: 'SubscriptionPayment',
        entityId: payment.id,
        summary,
        changes: {
          invoice: invoice.number,
          method: input.method,
          reference,
          paidAt: iso(input.paidAt),
          receipt: { type: input.receipt.mimeType, size: input.receipt.sizeBytes, sha256: input.receipt.sha256 },
        },
      });
      await notifyStore(tx, store.id, {
        type: 'PAYMENT_SUBMITTED',
        title: 'Payment submitted for verification',
        body: `We received your ${PAYMENT_METHOD_LABEL[input.method]} payment of ${money(invoice.amount)} for invoice ${invoice.number}. Your plan changes once it is verified.`,
        dedupeKey: `payment:${payment.id}:submitted`,
      });
      await notifyAdmin(tx, {
        kind: 'PAYMENT_SUBMITTED',
        title: `Payment to verify: ${store.name}`,
        body: `${PAYMENT_METHOD_LABEL[input.method]} ${money(invoice.amount)}, reference ${reference}, for invoice ${invoice.number}.`,
        href: `/system-admin/payments/${payment.id}`,
        storeId: store.id,
        dedupeKey: `payment:${payment.id}:submitted`,
      });
      return payment;
    }, TX);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && /one_pending_per_invoice|invoiceId/.test(JSON.stringify(error.meta ?? {}))) {
      throw new ConflictError('A payment for this invoice is already awaiting verification.');
    }
    if (isReferenceConflict(error)) {
      throw new ValidationError('That reference has already been recorded.', {
        reference: ['This reference was already used for a payment.'],
      });
    }
    throw error;
  }
}

// --- Administrator: verify or reject -------------------------------------------

/**
 * Confirms the money arrived. In one transaction: the payment becomes
 * VERIFIED, its invoice PAID, and the store moves to the invoice's plan and
 * interval, ACTIVE. The period bought is worked out now, by the same rule as
 * the invoice: it continues a trial or paid period still running (a renewal
 * never loses time already paid), and otherwise starts at this approval.
 * The payment records that period. A payment can be verified once only (the
 * store's row lock, a re-check of every state, and a database trigger), so a
 * retry or a second administrator cannot extend the subscription twice.
 */
export async function verifyPayment(actor: Actor, input: { paymentId: string }, now = new Date()): Promise<void> {
  const target = await platformPrisma.subscriptionPayment.findUnique({ where: { id: input.paymentId }, select: { storeId: true } });
  if (!target) throw new NotFoundError('Payment');

  await platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, target.storeId);
    const payment = await tx.subscriptionPayment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true, storeId: true, status: true, amount: true, currency: true, method: true, reference: true, voidedAt: true, createdAt: true,
        invoice: {
          select: { id: true, storeId: true, number: true, status: true, plan: true, interval: true, amount: true, currency: true, dueAt: true },
        },
      },
    });
    if (!payment) throw new NotFoundError('Payment');
    if (payment.status !== 'PENDING') throw new ConflictError('This payment has already been reviewed.');
    if (payment.voidedAt) throw new ConflictError('This payment is void.');
    if (!payment.invoice) throw new ConflictError('This payment is not linked to an invoice.');
    if (payment.invoice.storeId !== store.id || payment.storeId !== store.id) {
      throw new ConflictError('This payment and its invoice belong to different stores; it cannot be verified.');
    }
    if (payment.invoice.status !== 'OPEN') throw new ConflictError('Its invoice is already closed; reject this payment instead.');
    // There are no partial payments: one payment settles the invoice in full.
    // Compared as decimals, never as floating-point numbers.
    if (!payment.amount.equals(payment.invoice.amount) || payment.currency !== payment.invoice.currency) {
      throw new ConflictError(
        `The payment (${money(payment.amount)}) does not match the invoice amount (${money(payment.invoice.amount)}); reject it instead.`,
      );
    }
    // Submissions close when the invoice expires; anything later needs a new invoice.
    if (payment.createdAt.getTime() > invoiceExpiresAt(payment.invoice.dueAt).getTime()) {
      throw new ConflictError('This payment was submitted after its invoice expired; reject it and void the invoice.');
    }
    if (store.status === 'SUSPENDED') throw new ConflictError('This store is suspended. Reactivate it before verifying a payment.');

    const before = snapshot(store);
    // A renewal extends a paid period still running; otherwise this starts one.
    const renewal = store.status === 'ACTIVE' && store.currentPeriodEnd !== null && store.currentPeriodEnd.getTime() > now.getTime();
    const { periodStart, periodEnd } = invoicePeriod({ subscription: store, interval: payment.invoice.interval, now });

    await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: 'VERIFIED', verifiedAt: now, verifiedById: actor.id, periodStart, periodEnd },
    });
    await tx.invoice.update({ where: { id: payment.invoice.id }, data: { status: 'PAID', paidAt: now } });
    await tx.store.update({
      where: { id: store.id },
      data: { plan: payment.invoice.plan, status: 'ACTIVE', currentPeriodEnd: periodEnd, billingInterval: payment.invoice.interval },
    });
    await syncLimits(tx, store.id);

    await audit(tx, actor, store, {
      action: 'PAYMENT',
      entity: 'SubscriptionPayment',
      entityId: payment.id,
      summary: `Verified ${PAYMENT_METHOD_LABEL[payment.method]} payment ${payment.reference} (${money(payment.amount)}) for invoice ${payment.invoice.number}; ${PLANS[payment.invoice.plan].name} active until ${formatDate(periodEnd)}`,
      changes: {
        before,
        after: { plan: payment.invoice.plan, status: 'ACTIVE', currentPeriodEnd: iso(periodEnd), billingInterval: payment.invoice.interval },
        invoice: { number: payment.invoice.number, from: 'OPEN', to: 'PAID' },
        payment: { from: 'PENDING', to: 'VERIFIED', periodStart: iso(periodStart), periodEnd: iso(periodEnd) },
      },
    });
    await notifyStore(tx, store.id, {
      type: 'PAYMENT_VERIFIED',
      title: 'Payment verified',
      body: `Thank you. ${PLANS[payment.invoice.plan].name} is active until ${formatDate(periodEnd)}.`,
      dedupeKey: `payment:${payment.id}:verified`,
    });
    // Already read for the administrator who verified it; others still see it.
    await notifyAdmin(
      tx,
      {
        kind: renewal ? 'SUBSCRIPTION_RENEWED' : 'PAYMENT_VERIFIED',
        title: renewal ? `${store.name} renewed ${PLANS[payment.invoice.plan].name}` : `${store.name}: payment verified`,
        body: `${money(payment.amount)} for invoice ${payment.invoice.number}; active until ${formatDate(periodEnd)}.`,
        href: `/system-admin/stores/${store.id}`,
        storeId: store.id,
        dedupeKey: renewal ? platformNotificationKey.renewed(payment.id) : platformNotificationKey.paymentVerified(payment.id),
      },
      actor.id,
    );
  }, TX);
}

/** The money could not be found. The invoice stays open so the owner can pay and report again. */
export async function rejectPayment(actor: Actor, input: { paymentId: string; reason: string }, now = new Date()): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ValidationError('Say why the payment was rejected.', { reason: ['Give the owner a reason.'] });
  const target = await platformPrisma.subscriptionPayment.findUnique({ where: { id: input.paymentId }, select: { storeId: true } });
  if (!target) throw new NotFoundError('Payment');

  await platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, target.storeId);
    const payment = await tx.subscriptionPayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, status: true, amount: true, method: true, reference: true, invoice: { select: { number: true } } },
    });
    if (!payment) throw new NotFoundError('Payment');
    if (payment.status !== 'PENDING') throw new ConflictError('This payment has already been reviewed.');

    await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: 'REJECTED', rejectedAt: now, rejectedById: actor.id, rejectReason: reason.slice(0, 500) },
    });
    await audit(tx, actor, store, {
      action: 'PAYMENT',
      entity: 'SubscriptionPayment',
      entityId: payment.id,
      summary: `Rejected ${PAYMENT_METHOD_LABEL[payment.method]} payment ${payment.reference} (${money(payment.amount)})${payment.invoice ? ` for invoice ${payment.invoice.number}` : ''}: ${reason}`,
      changes: { reason, payment: { from: 'PENDING', to: 'REJECTED' } },
    });
    await notifyStore(tx, store.id, {
      type: 'PAYMENT_REJECTED',
      title: 'Payment could not be verified',
      body: `${reason} Your invoice is still open; you can submit corrected proof of payment.`,
      dedupeKey: `payment:${payment.id}:rejected`,
    });
    await notifyAdmin(
      tx,
      {
        kind: 'PAYMENT_REJECTED',
        title: `${store.name}: payment rejected`,
        body: `${PAYMENT_METHOD_LABEL[payment.method]} ${money(payment.amount)}, reference ${payment.reference}: ${reason}`,
        href: `/system-admin/stores/${store.id}`,
        storeId: store.id,
        dedupeKey: platformNotificationKey.paymentRejected(payment.id),
      },
      actor.id,
    );
  }, TX);
}

/** Cancels an open invoice the owner should not owe (a mistake, an agreed change). Payments awaiting review block it. */
export async function voidInvoice(actor: Actor, input: { invoiceId: string; reason: string }, now = new Date()): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ValidationError('Say why the invoice is being voided.', { reason: ['Give a reason.'] });
  const target = await platformPrisma.invoice.findUnique({ where: { id: input.invoiceId }, select: { storeId: true } });
  if (!target) throw new NotFoundError('Invoice');

  await platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, target.storeId);
    const invoice = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, number: true, status: true, amount: true, payments: { where: { status: 'PENDING' }, select: { id: true } } },
    });
    if (!invoice) throw new NotFoundError('Invoice');
    if (invoice.status !== 'OPEN') throw new ConflictError('Only an open invoice can be voided.');
    if (invoice.payments.length > 0) throw new ConflictError('Verify or reject the payment awaiting review first.');
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'VOID', voidedAt: now, voidedById: actor.id, voidReason: reason.slice(0, 500) },
    });
    await audit(tx, actor, store, {
      action: 'SUBSCRIPTION',
      entity: 'Invoice',
      entityId: invoice.id,
      summary: `Voided invoice ${invoice.number} (${money(invoice.amount)}): ${reason}`,
      changes: { reason },
    });
  }, TX);
}
