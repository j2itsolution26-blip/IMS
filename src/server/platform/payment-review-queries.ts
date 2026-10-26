import 'server-only';

import { Prisma, type StorePlan, type SubscriptionPaymentStatus } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { invoiceDisplayStatus, paymentDisplayStatus, type InvoiceDisplayStatus, type PaymentDisplayStatus } from '@/lib/billing';
import { checkoutAccounts, parseStoredPaymentAccounts } from '@/lib/payment-accounts';
import { PAYMENT_ACCOUNTS_KEY } from '@/server/platform/billing-service';

/**
 * Reads for payment verification: the administrator's queue and review page,
 * and the access checks in front of every receipt and QR code file.
 *
 * Callers authorise first (`platform.view` for the administrator). The
 * receipt lookups are the access rule itself: an owner gets only receipts of
 * the store they own, and anyone else gets nothing, whether or not it exists.
 */

// --- File access ------------------------------------------------------------------

export interface FileRef {
  storagePath: string;
  originalName: string;
}

/** A receipt, if `userId` owns the store it belongs to. Staff of that store get nothing. */
export async function findReceiptForOwner(userId: string, receiptId: string): Promise<FileRef | null> {
  return platformPrisma.subscriptionPaymentReceipt.findFirst({
    where: { id: receiptId, store: { ownerId: userId } },
    select: { storagePath: true, originalName: true },
  });
}

/** Payment id → receipt id for these payments, only for the store's owner; empty for anyone else. */
export async function receiptIdsForOwner(userId: string, paymentIds: string[]): Promise<Map<string, string>> {
  if (paymentIds.length === 0) return new Map();
  const rows = await platformPrisma.subscriptionPaymentReceipt.findMany({
    where: { paymentId: { in: paymentIds }, store: { ownerId: userId } },
    select: { id: true, paymentId: true },
  });
  return new Map(rows.map((row) => [row.paymentId, row.id]));
}

/** Any receipt, for a platform administrator. */
export async function findReceiptForAdmin(receiptId: string): Promise<FileRef | null> {
  return platformPrisma.subscriptionPaymentReceipt.findUnique({
    where: { id: receiptId },
    select: { storagePath: true, originalName: true },
  });
}

/**
 * A GCash account's QR code image. Store accounts see only accounts owners
 * can pay into; the administrator also sees hidden ones, to check them.
 */
export async function findQrPath(accountId: string, options: { admin: boolean }): Promise<string | null> {
  const row = await platformPrisma.platformSetting.findUnique({ where: { key: PAYMENT_ACCOUNTS_KEY }, select: { value: true } });
  const accounts = parseStoredPaymentAccounts(row?.value);
  const visible = options.admin ? accounts : checkoutAccounts(accounts);
  return visible.find((account) => account.id === accountId)?.qrPath ?? null;
}

// --- Queue --------------------------------------------------------------------------

export async function pendingPaymentCount(): Promise<number> {
  return platformPrisma.subscriptionPayment.count({ where: { status: 'PENDING' } });
}

export interface PaymentReviewMetrics {
  pending: number;
  approved: number;
  rejected: number;
  /** Verified, non-void money whose verification falls in the range. */
  verifiedInRange: { count: number; amount: number };
}

export async function paymentReviewMetrics(range: { from: Date; to: Date }): Promise<PaymentReviewMetrics> {
  const ownerSubmitted = { invoiceId: { not: null } };
  const [byStatus, verified] = await Promise.all([
    platformPrisma.subscriptionPayment.groupBy({ by: ['status'], where: ownerSubmitted, _count: { _all: true } }),
    platformPrisma.subscriptionPayment.aggregate({
      where: { status: 'VERIFIED', voidedAt: null, verifiedAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);
  const count = (status: SubscriptionPaymentStatus) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return {
    pending: count('PENDING'),
    approved: count('VERIFIED'),
    rejected: count('REJECTED'),
    verifiedInRange: { count: verified._count._all, amount: Number(verified._sum.amount ?? 0) },
  };
}

export const REVIEW_STATUS_FILTERS = ['PENDING', 'VERIFIED', 'REJECTED', 'VOID', 'ALL'] as const;
export type ReviewStatusFilter = (typeof REVIEW_STATUS_FILTERS)[number];

export interface PaymentRequestRow {
  id: string;
  storeId: string;
  storeName: string;
  ownerName: string | null;
  invoiceNumber: string | null;
  plan: StorePlan;
  interval: 'MONTHLY' | 'ANNUAL' | null;
  amount: number;
  method: 'GCASH' | 'BANK_TRANSFER' | 'OTHER';
  reference: string;
  paidAt: Date;
  submittedAt: Date;
  status: PaymentDisplayStatus;
  reviewerName: string | null;
  reviewedAt: Date | null;
  receiptId: string | null;
}

/**
 * Owner-submitted payments (those linked to an invoice), newest first, or
 * oldest first while showing only pending ones — the order to work through.
 * `q` matches store, owner, invoice number or reference.
 */
export async function listPaymentRequests(input: {
  status: ReviewStatusFilter;
  plan: StorePlan | null;
  q: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: PaymentRequestRow[]; total: number }> {
  const q = input.q.trim();
  const where: Prisma.SubscriptionPaymentWhereInput = {
    invoiceId: { not: null },
    ...(input.status === 'VOID'
      ? { voidedAt: { not: null } }
      : input.status === 'ALL'
        ? {}
        : { status: input.status, voidedAt: null }),
    ...(input.plan ? { plan: input.plan } : {}),
    ...(q
      ? {
          OR: [
            { store: { name: { contains: q, mode: 'insensitive' } } },
            { store: { owner: { name: { contains: q, mode: 'insensitive' } } } },
            { invoice: { number: { contains: q, mode: 'insensitive' } } },
            { reference: { contains: q.replace(/\s+/g, '').toUpperCase() } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    platformPrisma.subscriptionPayment.count({ where }),
    platformPrisma.subscriptionPayment.findMany({
      where,
      orderBy: { createdAt: input.status === 'PENDING' ? 'asc' : 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true, storeId: true, plan: true, amount: true, method: true, reference: true, paidAt: true, createdAt: true,
        status: true, voidedAt: true, verifiedAt: true, rejectedAt: true,
        store: { select: { name: true, owner: { select: { name: true } } } },
        invoice: { select: { number: true, interval: true } },
        verifiedBy: { select: { name: true } },
        rejectedBy: { select: { name: true } },
        receipt: { select: { id: true } },
      },
    }),
  ]);
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      storeId: row.storeId,
      storeName: row.store.name,
      ownerName: row.store.owner?.name ?? null,
      invoiceNumber: row.invoice?.number ?? null,
      plan: row.plan,
      interval: row.invoice?.interval ?? null,
      amount: Number(row.amount),
      method: row.method,
      reference: row.reference,
      paidAt: row.paidAt,
      submittedAt: row.createdAt,
      status: paymentDisplayStatus(row),
      reviewerName: row.verifiedBy?.name ?? row.rejectedBy?.name ?? null,
      reviewedAt: row.verifiedAt ?? row.rejectedAt ?? null,
      receiptId: row.receipt?.id ?? null,
    })),
  };
}

// --- One payment ------------------------------------------------------------------

export interface PaymentReview {
  id: string;
  status: PaymentDisplayStatus;
  amount: number;
  currency: string;
  method: 'GCASH' | 'BANK_TRANSFER' | 'OTHER';
  reference: string;
  paidAt: Date;
  submittedAt: Date;
  notes: string | null;
  submittedBy: string;
  periodStart: Date;
  periodEnd: Date;
  review: { by: string; at: Date; reason: string | null } | null;
  receipt: { id: string; mimeType: string; sizeBytes: number; originalName: string; sameImageElsewhere: number } | null;
  /** Other submissions with the same reference (rejected ones; a live one cannot exist). */
  sameReferenceElsewhere: number;
  invoice: {
    id: string;
    number: string;
    status: InvoiceDisplayStatus;
    plan: StorePlan;
    interval: 'MONTHLY' | 'ANNUAL';
    amount: number;
    periodStart: Date;
    periodEnd: Date;
    dueAt: Date;
    termsVersion: number;
    acceptedAt: Date;
    acceptedBy: string;
  } | null;
  store: {
    id: string;
    name: string;
    owner: { name: string; email: string | null; phone: string | null } | null;
    plan: StorePlan;
    status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  };
  history: { id: string; status: PaymentDisplayStatus; amount: number; reference: string; invoiceNumber: string | null; submittedAt: Date }[];
}

export async function getPaymentReview(paymentId: string, now: Date = new Date()): Promise<PaymentReview | null> {
  const payment = await platformPrisma.subscriptionPayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, status: true, voidedAt: true, amount: true, currency: true, method: true, reference: true, paidAt: true,
      createdAt: true, notes: true, periodStart: true, periodEnd: true,
      verifiedAt: true, rejectedAt: true, rejectReason: true,
      recordedBy: { select: { name: true } },
      verifiedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
      receipt: { select: { id: true, mimeType: true, sizeBytes: true, originalName: true, sha256: true } },
      invoice: {
        select: {
          id: true, number: true, status: true, plan: true, interval: true, amount: true, periodStart: true, periodEnd: true,
          dueAt: true, termsVersion: true, acceptedAt: true, acceptedBy: { select: { name: true } },
          payments: { where: { status: 'PENDING' }, select: { id: true } },
        },
      },
      store: {
        select: {
          id: true, name: true, plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true,
          owner: { select: { name: true, email: true, phone: true } },
        },
      },
    },
  });
  if (!payment) return null;

  const [sameImageElsewhere, sameReferenceElsewhere, history] = await Promise.all([
    payment.receipt
      ? platformPrisma.subscriptionPaymentReceipt.count({ where: { sha256: payment.receipt.sha256, paymentId: { not: payment.id } } })
      : Promise.resolve(0),
    platformPrisma.subscriptionPayment.count({ where: { method: payment.method, reference: payment.reference, id: { not: payment.id } } }),
    platformPrisma.subscriptionPayment.findMany({
      where: { storeId: payment.store.id, id: { not: payment.id } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, status: true, voidedAt: true, amount: true, reference: true, createdAt: true, invoice: { select: { number: true } } },
    }),
  ]);

  const review =
    payment.verifiedAt && payment.verifiedBy
      ? { by: payment.verifiedBy.name, at: payment.verifiedAt, reason: null }
      : payment.rejectedAt && payment.rejectedBy
        ? { by: payment.rejectedBy.name, at: payment.rejectedAt, reason: payment.rejectReason }
        : null;

  return {
    id: payment.id,
    status: paymentDisplayStatus(payment),
    amount: Number(payment.amount),
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt,
    submittedAt: payment.createdAt,
    notes: payment.notes,
    submittedBy: payment.recordedBy.name,
    periodStart: payment.periodStart,
    periodEnd: payment.periodEnd,
    review,
    receipt: payment.receipt
      ? {
          id: payment.receipt.id,
          mimeType: payment.receipt.mimeType,
          sizeBytes: payment.receipt.sizeBytes,
          originalName: payment.receipt.originalName,
          sameImageElsewhere,
        }
      : null,
    sameReferenceElsewhere,
    invoice: payment.invoice
      ? {
          id: payment.invoice.id,
          number: payment.invoice.number,
          status: invoiceDisplayStatus(payment.invoice, payment.invoice.payments.length > 0, now),
          plan: payment.invoice.plan,
          interval: payment.invoice.interval,
          amount: Number(payment.invoice.amount),
          periodStart: payment.invoice.periodStart,
          periodEnd: payment.invoice.periodEnd,
          dueAt: payment.invoice.dueAt,
          termsVersion: payment.invoice.termsVersion,
          acceptedAt: payment.invoice.acceptedAt,
          acceptedBy: payment.invoice.acceptedBy.name,
        }
      : null,
    store: payment.store,
    history: history.map((row) => ({
      id: row.id,
      status: paymentDisplayStatus(row),
      amount: Number(row.amount),
      reference: row.reference,
      invoiceNumber: row.invoice?.number ?? null,
      submittedAt: row.createdAt,
    })),
  };
}
