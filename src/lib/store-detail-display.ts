import type { StoreAccess } from './store-access';
import { daysUntil } from './subscription';

/**
 * How the administrator's store page reads a store's records: the period
 * countdown, invoice and payment badges, and who made each history entry.
 * Pure, and only presentation — every rule it reflects is enforced
 * elsewhere.
 */

export type DisplayTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export interface Countdown {
  /** "Trial ends", "Paid through", "Read-only from", … */
  label: string;
  date: Date | null;
  /** Whole days left, or null when nothing is counting down. */
  days: number | null;
  tone: DisplayTone;
}

/** What the store's clock is counting down to, if anything. */
export function periodCountdown(access: StoreAccess, now: Date): Countdown {
  switch (access.state) {
    case 'TRIAL': {
      const days = daysUntil(access.endsAt, now);
      return { label: 'Trial ends', date: access.endsAt, days, tone: days !== null && days <= 7 ? 'warning' : 'info' };
    }
    case 'ACTIVE': {
      const days = daysUntil(access.endsAt, now);
      return { label: 'Paid through', date: access.endsAt, days, tone: days !== null && days <= 7 ? 'warning' : 'success' };
    }
    case 'GRACE':
      return { label: 'Read-only from', date: access.graceEndsAt, days: daysUntil(access.graceEndsAt, now), tone: 'warning' };
    case 'READ_ONLY':
      return { label: 'Read-only since', date: access.graceEndsAt, days: null, tone: 'danger' };
    case 'SUSPENDED':
      return { label: 'Suspended', date: null, days: null, tone: 'danger' };
  }
}

/** "12 days left", "Ends today", or null when there is no countdown. */
export function countdownText(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return 'Ends today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

export interface DisplayBadge {
  label: string;
  tone: DisplayTone;
}

/** An invoice as the administrator should read it. A paid invoice is never shown as owing. */
export function invoiceBadge(invoice: { status: 'OPEN' | 'PAID' | 'VOID'; dueAt: Date; hasPendingPayment: boolean }, now: Date): DisplayBadge {
  if (invoice.status === 'PAID') return { label: 'Paid', tone: 'success' };
  if (invoice.status === 'VOID') return { label: 'Void', tone: 'neutral' };
  if (invoice.hasPendingPayment) return { label: 'Payment to verify', tone: 'info' };
  return invoice.dueAt.getTime() < now.getTime() ? { label: 'Past due', tone: 'danger' } : { label: 'Open', tone: 'warning' };
}

/** A payment's state. Void wins over whatever its review said: voided money is not money received. */
export function paymentBadge(payment: { status: 'PENDING' | 'VERIFIED' | 'REJECTED'; voidedAt: Date | null }): DisplayBadge {
  if (payment.voidedAt) return { label: 'Void', tone: 'neutral' };
  switch (payment.status) {
    case 'PENDING':
      return { label: 'Pending', tone: 'warning' };
    case 'VERIFIED':
      return { label: 'Verified', tone: 'success' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'danger' };
  }
}

/** Who made a history entry, relative to this store. */
export type ActorRole = 'OWNER' | 'STAFF' | 'ADMIN' | 'SYSTEM';

export const ACTOR_ROLE_LABEL: Record<ActorRole, string> = { OWNER: 'Owner', STAFF: 'Store staff', ADMIN: 'Admin', SYSTEM: 'System' };

export function actorRole(user: { id: string; storeId: string | null } | null, store: { id: string; ownerId: string | null }): ActorRole {
  if (!user) return 'SYSTEM';
  if (user.storeId !== store.id) return 'ADMIN';
  return user.id === store.ownerId ? 'OWNER' : 'STAFF';
}

/** What kind of change a history entry records, for its icon. */
export type HistoryKind = 'PAYMENT' | 'INVOICE' | 'PLAN' | 'STATUS';

export function historyKind(entry: { entity: string; summary: string }): HistoryKind {
  if (entry.entity === 'SubscriptionPayment') return 'PAYMENT';
  if (entry.entity === 'Invoice') return 'INVOICE';
  return /\bplan\b/i.test(entry.summary) ? 'PLAN' : 'STATUS';
}
