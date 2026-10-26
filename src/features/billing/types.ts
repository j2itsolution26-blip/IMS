import type { PlanId } from '@/lib/plans';
import type { BillingFlag, BillingInterval, InvoiceDisplayStatus, PaymentDisplayStatus, TimelineStepKey, TimelineStepState } from '@/lib/billing';
import type { PaymentMethod } from '@/lib/subscription';

/**
 * What the Subscription & Billing screen hands its client components: plain,
 * serialisable copies of server rows. Dates are ISO strings, money is a
 * number of pesos, and every status is already worked out on the server.
 */

export interface PlanPrice {
  plan: PlanId;
  interval: BillingInterval;
  amount: number;
}

export interface SubscriptionDates {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

export interface BillingTermsInfo {
  version: number;
  body: string;
}

export interface OpenInvoiceInfo {
  id: string;
  number: string;
  plan: PlanId;
  interval: BillingInterval;
  amount: number;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  flag: BillingFlag;
  issuedAt: string;
  /** Open, awaiting verification or overdue. */
  status: InvoiceDisplayStatus;
  pending: { method: PaymentMethod; reference: string; submittedAt: string; paidAt: string; receiptId: string | null } | null;
  lastRejection: { reason: string; at: string } | null;
  /** The payment lifecycle from `paymentTimeline`. */
  timeline: { key: TimelineStepKey; state: TimelineStepState; at: string | null; reason?: string }[];
}

export interface InvoiceRow {
  id: string;
  number: string;
  plan: PlanId;
  interval: BillingInterval;
  amount: number;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  voidReason: string | null;
  status: InvoiceDisplayStatus;
  termsVersion: number;
}

export interface PaymentRow {
  id: string;
  paidAt: string;
  submittedAt: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  plan: PlanId;
  months: number;
  periodStart: string;
  periodEnd: string;
  status: PaymentDisplayStatus;
  rejectReason: string | null;
  voidReason: string | null;
  /** "You", a store member's name, or "Platform administrator" — never an administrator's name. */
  recordedBy: string;
  verifiedAt: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  /** The owner's own receipt for this payment; null for staff, and for payments recorded by the administrator. */
  receiptId: string | null;
}

/**
 * An account owners can pay into, as checkout shows it. The QR code is an
 * access-checked link, never the file's location in storage.
 */
export interface CheckoutAccount {
  id: string;
  kind: 'GCASH' | 'BANK_TRANSFER';
  bankName: string | null;
  accountName: string;
  accountNumber: string;
  note: string | null;
  qrSrc: string | null;
}
