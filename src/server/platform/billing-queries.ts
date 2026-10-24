import 'server-only';

import type { SubscriptionPaymentMethod } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { billingSnapshot, monthlyRecurringRevenue } from '@/lib/billing';
import type { SubscriptionRow } from '@/lib/subscription-filters';

/**
 * Reads for the administrator's billing screens. Counts and money come from
 * the database; statuses are derived by `billingSnapshot` from the same
 * fields that drive access, so the dashboard and enforcement cannot disagree.
 *
 * The store list is derived in memory: a platform has tens or hundreds of
 * stores, and the status filters depend on dates relative to now, which do
 * not index well. Revisit with SQL-side filtering past a few thousand stores.
 */

/** Every store's billing position, newest store first. */
export async function loadSubscriptionRows(now: Date = new Date()): Promise<SubscriptionRow[]> {
  const stores = await platformPrisma.store.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      plan: true,
      status: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      owner: { select: { name: true, username: true, email: true, phone: true } },
      invoices: {
        where: { status: 'OPEN' },
        take: 1,
        select: { id: true, number: true, plan: true, interval: true, amount: true, currency: true, dueAt: true },
      },
      subscriptionPayments: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, status: true, invoiceId: true, amount: true, verifiedAt: true, voidedAt: true, createdAt: true },
      },
    },
  });

  return stores.map((store) => {
    const invoice = store.invoices[0] ?? null;
    const pending = invoice
      ? store.subscriptionPayments.find((payment) => payment.invoiceId === invoice.id && payment.status === 'PENDING') ?? null
      : null;
    const verified = store.subscriptionPayments.find((payment) => payment.status === 'VERIFIED' && !payment.voidedAt) ?? null;
    const snapshot = billingSnapshot({
      subscription: store,
      openInvoice: invoice ? { id: invoice.id, dueAt: invoice.dueAt } : null,
      hasPendingPayment: pending !== null,
      now,
    });
    return {
      storeId: store.id,
      storeName: store.name,
      owner: store.owner,
      plan: store.plan,
      lifecycle: snapshot.lifecycle,
      billing: snapshot.billing,
      grace: snapshot.grace,
      readOnly: snapshot.readOnly,
      trialEndsAt: store.trialEndsAt,
      currentPeriodEnd: store.currentPeriodEnd,
      openInvoice: invoice ? { ...invoice, amount: Number(invoice.amount) } : null,
      pendingPaymentId: pending?.id ?? null,
      lastVerifiedPayment: verified ? { at: verified.verifiedAt ?? verified.createdAt, amount: Number(verified.amount) } : null,
      lastPaymentStatus: store.subscriptionPayments[0]?.status ?? null,
    };
  });
}

/** Verified money in a period, and MRR. Pending, rejected and void payments are never counted. */
export async function billingMetrics(range: { from: Date; to: Date }, now: Date = new Date()) {
  const [collected, covering] = await Promise.all([
    platformPrisma.subscriptionPayment.aggregate({
      where: { status: 'VERIFIED', voidedAt: null, verifiedAt: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    platformPrisma.subscriptionPayment.findMany({
      where: { status: 'VERIFIED', voidedAt: null, periodStart: { lte: now }, periodEnd: { gt: now } },
      select: { storeId: true, status: true, voidedAt: true, amount: true, months: true, periodStart: true, periodEnd: true },
    }),
  ]);
  return {
    collected: Number(collected._sum.amount ?? 0),
    collectedCount: collected._count._all,
    mrr: monthlyRecurringRevenue(
      covering.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
      now,
    ),
    /** Stores with verified money covering today — the ones the MRR is drawn from. */
    mrrStores: new Set(covering.map((payment) => payment.storeId)).size,
  };
}

export interface PendingPaymentRow {
  id: string;
  storeId: string;
  storeName: string;
  invoiceNumber: string | null;
  amount: number;
  method: SubscriptionPaymentMethod;
  reference: string;
  paidAt: Date;
  submittedAt: Date;
  submittedBy: string;
  notes: string | null;
}

/** Payments owners reported that await the administrator's check, oldest first. */
export async function listPendingPayments(): Promise<PendingPaymentRow[]> {
  const rows = await platformPrisma.subscriptionPayment.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, storeId: true, amount: true, method: true, reference: true, paidAt: true, createdAt: true, notes: true,
      store: { select: { name: true } },
      invoice: { select: { number: true } },
      recordedBy: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    storeId: row.storeId,
    storeName: row.store.name,
    invoiceNumber: row.invoice?.number ?? null,
    amount: Number(row.amount),
    method: row.method,
    reference: row.reference,
    paidAt: row.paidAt,
    submittedAt: row.createdAt,
    submittedBy: row.recordedBy.name,
    notes: row.notes,
  }));
}

/** The administrator's latest billing notifications. */
export async function listPlatformNotifications(limit = 8) {
  return platformPrisma.platformNotification.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, title: true, body: true, href: true, createdAt: true, readAt: true },
  });
}
