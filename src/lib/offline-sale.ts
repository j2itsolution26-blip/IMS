import { z } from 'zod';
import { lineQuantity } from '@/lib/quantity';

/**
 * The offline-sale contract shared by the till (which writes these into its
 * IndexedDB outbox) and the upload endpoint, POST /api/pos/sync.
 *
 * Pure: no database, no `window`. The rules that decide how an upload is
 * judged live here so they are unit-tested directly (tests/offline-sale.test.ts).
 *
 * Policy, in short (docs in docs/offline-pos.md):
 *   - An offline sale is cash only. GCash needs the store account checked,
 *     which needs a connection.
 *   - It is recorded at the price actually charged: the money is already in
 *     the drawer. A price, tax rate or total that does not match the server's
 *     records is flagged for the owner, never silently rewritten or dropped.
 *   - Stock may go below zero; that is flagged too.
 *   - The same sale id uploaded twice records one sale.
 */

/** Longest basket the till accepts, online or offline. */
export const MAX_OFFLINE_LINES = 200;

/** Largest single amount an offline sale may carry (a typo guard, not a business limit). */
export const MAX_OFFLINE_AMOUNT = 10_000_000;

/**
 * How far back a device's catalogue copy may vouch for a price. A price
 * older than this before the sale is checked from this point instead, so an
 * ancient snapshot cannot be used to sell at last year's price unflagged.
 */
export const PRICE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const amount = z.number().finite().min(0).max(MAX_OFFLINE_AMOUNT);
const id = z.string().trim().min(1).max(64);

export const offlineSaleSchema = z.object({
  /** The local transaction id, used as the sale's clientRequestId. */
  id: z.string().uuid(),
  /** Printed on the PENDING SYNC receipt, e.g. OFF-3F2A-000012. */
  localReceiptNumber: z.string().trim().min(1).max(40),
  /** When the cashier completed the sale, by the device's clock. */
  occurredAt: z.string().datetime({ offset: true }),
  /** When the device last downloaded the catalogue it priced this sale from. */
  catalogFetchedAt: z.string().datetime({ offset: true }),
  /** The cashier who rang it up; must be the signed-in user uploading it. */
  userId: id,
  shiftId: id,
  warehouseId: id,
  /** The tax rate the device applied, in percent. */
  taxRate: z.number().finite().min(0).max(100),
  items: z
    .array(
      z.object({
        productId: id,
        quantity: lineQuantity,
        /** The price charged per unit. */
        unitPrice: amount,
        discount: amount.default(0),
      }),
    )
    .min(1, 'The sale has no items.')
    .max(MAX_OFFLINE_LINES),
  discount: amount.default(0),
  /** Cash the customer handed over. */
  cashTendered: amount,
  /** The total the device showed the customer. */
  total: amount,
  notes: z.string().max(500).optional(),
});

export const offlineSyncRequestSchema = z.object({
  deviceId: z.string().uuid(),
  sale: offlineSaleSchema,
});

export type OfflineSale = z.infer<typeof offlineSaleSchema>;
export type OfflineSaleInput = z.input<typeof offlineSaleSchema>;
export type OfflineSyncRequest = z.input<typeof offlineSyncRequestSchema>;

/**
 * Files a sale at the time it happened, but never before its shift opened
 * and never in the future: a device clock that is wrong cannot move revenue
 * into another day's report.
 */
export function clampOccurredAt(occurredAt: Date, bounds: { openedAt: Date; now: Date }): { at: Date; clamped: boolean } {
  const time = occurredAt.getTime();
  if (!Number.isFinite(time)) return { at: bounds.now, clamped: true };
  if (time < bounds.openedAt.getTime()) return { at: bounds.openedAt, clamped: true };
  if (time > bounds.now.getTime()) return { at: bounds.now, clamped: true };
  return { at: occurredAt, clamped: false };
}

export interface PriceChange {
  oldValue: number;
  newValue: number;
  at: Date;
}

/**
 * Every selling price the product had at some point between `from` and `to`.
 *
 * The device priced the sale from its catalogue copy, so any price in force
 * from the moment that copy was taken until the sale is one the cashier may
 * honestly have charged. `changes` are the product's SELLING price changes,
 * in any order; `current` is today's price.
 */
export function pricesInEffect(input: { current: number; changes: PriceChange[]; from: Date; to: Date }): number[] {
  const changes = [...input.changes].sort((a, b) => a.at.getTime() - b.at.getTime());
  const from = input.from.getTime();
  const to = input.to.getTime();

  // The price at `from`: the last change at or before it, else the price the
  // first later change replaced, else today's.
  const before = changes.filter((c) => c.at.getTime() <= from);
  const after = changes.filter((c) => c.at.getTime() > from);
  const atStart = before.length > 0 ? before[before.length - 1].newValue : after.length > 0 ? after[0].oldValue : input.current;

  const prices = new Set<number>([toCents(atStart)]);
  for (const change of after) {
    if (change.at.getTime() <= to) prices.add(toCents(change.newValue));
  }
  return [...prices].map((cents) => cents / 100);
}

/** True if `charged` is one of `prices`, to the centavo. */
export function priceWasInEffect(charged: number, prices: number[]): boolean {
  const cents = toCents(charged);
  return prices.some((price) => toCents(price) === cents);
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

/** What the upload endpoint answers. */
export type SyncResponse =
  | {
      ok: true;
      /** `duplicate`: this id was already recorded; nothing new was written. */
      status: 'recorded' | 'duplicate';
      sale: { id: string; invoiceNumber: string; total: number; paidAmount: number; changeAmount: number; receivedAt: string };
      /** Kinds of issue raised for the owner, if any. */
      issues: string[];
    }
  | { ok: false; code: string; error: string; retryable: boolean };

/**
 * What the till should do with an outbox entry after an upload attempt.
 *
 *   synced    - the server has it; store the invoice number.
 *   retry     - a passing problem (network, server, rate limit): back off and try again.
 *   reauth    - the session ended: keep the sale, ask the cashier to sign in.
 *   blocked   - nothing is wrong with the sale, but it cannot go up yet
 *               (screen locked, another cashier signed in, store read-only).
 *               Try again when that changes, not on a timer.
 *   rejected  - the server refused the sale itself. Keep it and show why; it
 *               is never deleted.
 */
export type SyncOutcome = 'synced' | 'retry' | 'reauth' | 'blocked' | 'rejected';

export function classifySyncResult(httpStatus: number | null, body: SyncResponse | null): SyncOutcome {
  // No answer at all: offline, DNS, a dropped connection, a timeout.
  if (httpStatus === null) return 'retry';
  if (body?.ok === true) return 'synced';
  if (httpStatus === 401) return 'reauth';
  if (httpStatus === 429 || httpStatus >= 500) return 'retry';
  if (httpStatus === 403 || httpStatus === 423) return 'blocked';
  // A body the server did not write (a proxy's error page) says nothing about the sale.
  if (!body) return 'retry';
  if (body.retryable) return 'retry';
  return 'rejected';
}

/**
 * Delay before retry number `attempt` (1-based): doubling from 2 s up to
 * 5 minutes, with up to 20% jitter so a room full of tills coming back online
 * together does not hit the server in lockstep.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(2_000 * 2 ** Math.max(0, attempt - 1), 5 * 60_000);
  return Math.round(base * (1 + random() * 0.2));
}
