import { classifySyncResult, retryDelayMs, type SyncOutcome, type SyncResponse } from '@/lib/offline-sale';
import { META, type OutboxEntry, type OutboxResult, type PosDb } from '@/features/offline/local-db';
import {
  appendLog,
  entriesToSend,
  getEntry,
  nextDueAt,
  prune,
  readMeta,
  summarize,
  updateEntry,
  writeMeta,
  type OutboxSummary,
} from '@/features/offline/outbox';

/**
 * Sends the till's outbox to the server.
 *
 * Two ways in:
 *
 *   submitAtCounter(id)  the live checkout, while the customer waits. A few
 *                        quick attempts; a clear refusal declines the sale
 *                        (nothing was charged), a clear success completes it,
 *                        and an unknown outcome (lost response, dropped
 *                        connection, server error) keeps it as PENDING SYNC:
 *                        the cashier completes the sale and it is sent again
 *                        with the same id, which can never record it twice.
 *   run(trigger)         a background pass over everything still unsent,
 *                        oldest first, on start, reconnection, return to the
 *                        tab, after a sale, a timer or the Retry button.
 *
 * Only one pass runs at a time across all tabs (Web Locks, where supported;
 * otherwise per tab, which the server's idempotency makes safe anyway). An
 * entry is only ever changed after the server has answered. Nothing is ever
 * deleted because sending failed.
 */

export interface SendResult {
  /** null: no answer at all (offline, DNS, timeout, connection dropped). */
  httpStatus: number | null;
  body: SyncResponse | null;
}

export interface SyncTransport {
  send(entry: OutboxEntry): Promise<SendResult>;
}

export type SyncTrigger = 'start' | 'online' | 'resume' | 'sale' | 'timer' | 'manual' | 'signin';

export interface SyncScope {
  storeId: string;
  userId: string;
}

export type CounterOutcome =
  | { kind: 'synced'; entry: OutboxEntry }
  | { kind: 'pending'; entry: OutboxEntry }
  | { kind: 'declined'; entry: OutboxEntry; error: string; code: string };

export interface SyncState extends OutboxSummary {
  /** null until checked; false when this browser cannot store sales locally. */
  available: boolean | null;
  syncing: boolean;
  /** Whether the last request reached the server; null before any. */
  reachable: boolean | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

const REQUEST_TIMEOUT_MS = 20_000;
/** How long the counter owns a new entry before background passes may pick it up. */
const COUNTER_HOLD_MS = 60_000;
const COUNTER_DELAYS_MS = [0, 1_500, 3_000];
const LOCK_NAME = 'tpm-pos-sync';

/** The real transport: fetch to the app's own stable endpoints. */
export function httpTransport(fetchImpl: typeof fetch = (...args) => fetch(...args)): SyncTransport {
  return {
    async send(entry) {
      const request =
        entry.route === 'sync' && entry.offline
          ? { url: '/api/pos/sync', body: { deviceId: entry.deviceId, sale: entry.offline } }
          : { url: '/api/pos/checkout', body: { ...entry.checkout, clientRequestId: entry.id } };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(request.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body),
          credentials: 'same-origin',
          cache: 'no-store',
          // A redirect here can only be to the sign-in page.
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
          return { httpStatus: 401, body: null };
        }
        let body: SyncResponse | null = null;
        try {
          body = (await response.json()) as SyncResponse;
          if (typeof body !== 'object' || body === null || typeof (body as { ok?: unknown }).ok !== 'boolean') body = null;
        } catch {
          body = null;
        }
        return { httpStatus: response.status, body };
      } catch {
        return { httpStatus: null, body: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function resultFrom(body: SyncResponse | null): OutboxResult | null {
  if (!body || body.ok !== true) return null;
  return {
    saleId: body.sale.id,
    invoiceNumber: body.sale.invoiceNumber,
    total: body.sale.total,
    paidAmount: body.sale.paidAmount,
    changeAmount: body.sale.changeAmount,
    receivedAt: body.sale.receivedAt,
    issues: body.issues,
  };
}

function errorFrom(response: SendResult, now: Date): OutboxEntry['lastError'] {
  const body = response.body;
  if (body && body.ok === false) return { code: body.code, message: body.error, at: now.toISOString() };
  if (response.httpStatus === null) return { code: 'NETWORK', message: 'The server could not be reached.', at: now.toISOString() };
  if (response.httpStatus === 401) return { code: 'UNAUTHORIZED', message: 'Sign in again to send this sale.', at: now.toISOString() };
  return { code: `HTTP_${response.httpStatus}`, message: `The server answered ${response.httpStatus}.`, at: now.toISOString() };
}

const STATUS_FOR: Record<Exclude<SyncOutcome, 'synced' | 'retry'>, OutboxEntry['status']> = {
  reauth: 'reauth',
  blocked: 'blocked',
  rejected: 'rejected',
};

export interface SyncEngineOptions {
  getDb: () => Promise<PosDb>;
  transport: SyncTransport;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called after this tab changed the outbox, so other tabs can refresh. */
  onDatabaseChange?: () => void;
  /** Cross-tab mutex; defaults to navigator.locks when present. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T | null>;
}

export class SyncEngine {
  private scope: SyncScope | null = null;
  private state: SyncState = { available: null, syncing: false, reachable: null, lastSyncAt: null, lastError: null, pending: 0, attention: 0, othersUnsynced: 0 };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pruned = false;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly withLock: <T>(fn: () => Promise<T>) => Promise<T | null>;

  constructor(private readonly options: SyncEngineOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.withLock = options.withLock ?? defaultLock;
  }

  // --- State for the UI ---------------------------------------------------

  getState = (): SyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private changed(): void {
    this.options.onDatabaseChange?.();
  }

  /** Re-reads the counts from the database (also after another tab changed it). */
  async refresh(): Promise<void> {
    const scope = this.scope;
    if (!scope) return;
    try {
      const db = await this.options.getDb();
      const [summary, lastSyncAt] = await Promise.all([summarize(db, scope), readMeta<string>(db, META.lastSyncAt)]);
      this.setState({ ...summary, available: true, lastSyncAt: lastSyncAt ?? null });
    } catch {
      this.setState({ available: false });
    }
  }

  /** Who is signed in. Null on a page with no store cashier: nothing is sent. */
  configure(scope: SyncScope | null): void {
    const changed = scope?.storeId !== this.scope?.storeId || scope?.userId !== this.scope?.userId;
    this.scope = scope;
    if (changed) {
      // Unknown until re-read for the new cashier.
      this.setState({ pending: 0, attention: 0, othersUnsynced: 0, available: scope ? null : this.state.available });
      void this.refresh();
    }
  }

  // --- The live checkout --------------------------------------------------

  /** Holds a just-saved entry for the counter, so a background pass leaves it alone. */
  static counterHold(now: number): number {
    return now + COUNTER_HOLD_MS;
  }

  async submitAtCounter(id: string): Promise<CounterOutcome> {
    const db = await this.options.getDb();
    let entry = await getEntry(db, id);
    if (!entry) throw new Error('The sale is not on this device.');

    // Whether any attempt may have reached the server and been recorded.
    let maybeRecorded = false;
    let last: SendResult = { httpStatus: null, body: null };

    for (const delay of COUNTER_DELAYS_MS) {
      if (delay > 0) await this.sleep(delay);
      last = await this.options.transport.send(entry);
      const outcome = classifySyncResult(last.httpStatus, last.body);
      this.setState({ reachable: last.httpStatus !== null });
      await this.log(db, entry, outcome, last);

      if (outcome === 'synced') {
        entry = (await this.markSynced(db, entry.id, last))!;
        this.changed();
        return { kind: 'synced', entry };
      }
      if (outcome === 'rejected' || ((outcome === 'blocked' || outcome === 'reauth') && !maybeRecorded)) {
        // The server answered and did not record it (a repeat of a recorded
        // sale would have come back as a success): the customer is told.
        const error = errorFrom(last, new Date(this.now()));
        entry = (await updateEntry(db, entry.id, (e) => ({ ...e, status: 'declined', lastError: error, nextAttemptAt: null })))!;
        await this.refresh();
        this.changed();
        return { kind: 'declined', entry, error: error!.message, code: error!.code };
      }
      if (outcome === 'blocked' || outcome === 'reauth') {
        entry = (await updateEntry(db, entry.id, (e) => ({ ...e, status: STATUS_FOR[outcome], lastError: errorFrom(last, new Date(this.now())), nextAttemptAt: null })))!;
        await this.refresh();
        this.changed();
        return { kind: 'pending', entry };
      }
      // retry: no answer, a server error, or rate limited.
      if (last.httpStatus === null || last.httpStatus >= 500) maybeRecorded = true;
    }

    if (!maybeRecorded) {
      const error = errorFrom(last, new Date(this.now()));
      entry = (await updateEntry(db, entry.id, (e) => ({ ...e, status: 'declined', lastError: error, nextAttemptAt: null })))!;
      await this.refresh();
      this.changed();
      return { kind: 'declined', entry, error: 'The server is busy. Nothing was charged; try again in a moment.', code: error!.code };
    }

    // Unknown: keep it and finish the sale on the device. A cash sale goes up
    // as charged; GCash keeps the live checkout, which needs the server.
    const attempts = entry.attempts + 1;
    entry = (await updateEntry(db, entry.id, (e) => ({
      ...e,
      status: 'pending',
      route: e.offline ? 'sync' : 'checkout',
      attempts,
      nextAttemptAt: this.now() + retryDelayMs(attempts, this.random),
      lastError: errorFrom(last, new Date(this.now())),
    })))!;
    await this.refresh();
    this.changed();
    this.schedule();
    return { kind: 'pending', entry };
  }

  // --- Background passes ----------------------------------------------------

  /** Runs a pass now, or right after the one in progress. */
  run(trigger: SyncTrigger, onlyIds?: string[]): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.withLock(() => this.pass(trigger, onlyIds));
        } while (this.rerun);
      } finally {
        this.running = null;
        this.schedule();
      }
    })();
    return this.running;
  }

  private async pass(trigger: SyncTrigger, onlyIds?: string[]): Promise<void> {
    const scope = this.scope;
    if (!scope) return;
    let db: PosDb;
    try {
      db = await this.options.getDb();
    } catch {
      this.setState({ available: false });
      return;
    }
    if (!this.pruned) {
      this.pruned = true;
      await prune(db, this.now()).catch(() => 0);
    }

    const includeHeld = trigger !== 'timer' && trigger !== 'sale';
    const due = await entriesToSend(db, scope, { now: this.now(), includeHeld, onlyIds });
    if (due.length === 0) {
      await this.refresh();
      return;
    }

    this.setState({ syncing: true });
    try {
      for (const entry of due) {
        // Signed out or switched user mid-pass: stop.
        if (this.scope?.userId !== scope.userId || this.scope?.storeId !== scope.storeId) break;
        const response = await this.options.transport.send(entry);
        const outcome = classifySyncResult(response.httpStatus, response.body);
        this.setState({ reachable: response.httpStatus !== null });
        await this.log(db, entry, outcome, response);

        if (outcome === 'synced') {
          await this.markSynced(db, entry.id, response);
          continue;
        }
        const error = errorFrom(response, new Date(this.now()));
        if (outcome === 'retry') {
          await updateEntry(db, entry.id, (e) => ({
            ...e,
            status: 'pending',
            attempts: e.attempts + 1,
            nextAttemptAt: this.now() + retryDelayMs(e.attempts + 1, this.random),
            lastError: error,
          }));
          this.setState({ lastError: error?.message ?? null });
          // The server is unreachable: the rest would fail the same way.
          if (response.httpStatus === null) break;
          continue;
        }
        await updateEntry(db, entry.id, (e) => ({ ...e, status: STATUS_FOR[outcome], nextAttemptAt: null, lastError: error }));
        this.setState({ lastError: error?.message ?? null });
        // Every later request would meet the same expired session.
        if (outcome === 'reauth') break;
      }
    } finally {
      this.setState({ syncing: false });
      await this.refresh();
      this.changed();
    }
  }

  /** Arms a timer for the next due retry (at most 5 minutes away). */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const scope = this.scope;
    if (!scope) return;
    void (async () => {
      try {
        const db = await this.options.getDb();
        const due = await nextDueAt(db, scope);
        if (due === null) return;
        const wait = Math.min(Math.max(due - this.now(), 1_000), 5 * 60_000);
        this.timer = setTimeout(() => void this.run('timer'), wait);
        // Never keeps a Node process (tests) alive; browsers ignore this.
        (this.timer as { unref?: () => void }).unref?.();
      } catch {
        // No database: nothing to retry.
      }
    })();
  }

  private async markSynced(db: PosDb, id: string, response: SendResult): Promise<OutboxEntry | null> {
    const result = resultFrom(response.body);
    const updated = await updateEntry(db, id, (e) => ({ ...e, status: 'synced', result, lastError: null, nextAttemptAt: null }));
    const at = new Date(this.now()).toISOString();
    await writeMeta(db, META.lastSyncAt, at);
    this.setState({ lastSyncAt: at, lastError: null });
    await this.refresh();
    return updated;
  }

  private async log(db: PosDb, entry: OutboxEntry, outcome: SyncOutcome, response: SendResult): Promise<void> {
    const body = response.body;
    await appendLog(db, {
      at: new Date(this.now()).toISOString(),
      entryId: entry.id,
      storeId: entry.storeId,
      outcome,
      httpStatus: response.httpStatus,
      code: body && body.ok === false ? body.code : null,
      message: body && body.ok === false ? body.error : null,
    }).catch(() => undefined);
  }
}

async function defaultLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  // Another tab is already sending: let it.
  return locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? fn() : null));
}
