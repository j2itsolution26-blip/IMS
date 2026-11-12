import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { META, closeLocalDb, openLocalDb, type OutboxEntry, type PosDb } from '@/features/offline/local-db';
import { getEntry, readMeta, recordSale, updateEntry } from '@/features/offline/outbox';
import { SyncEngine, type SendResult, type SyncTransport } from '@/features/offline/sync-engine';
import type { SyncResponse } from '@/lib/offline-sale';
import { draft } from './helpers/outbox-draft';

const scope = { storeId: 'store_a', userId: 'cashier_1' };
let db: PosDb;
let clock = Date.parse('2026-11-12T08:00:00Z');

/** A scripted server: answers in order, then repeats the last answer. Records what was sent. */
function server(...answers: (SendResult | ((entry: OutboxEntry) => SendResult))[]) {
  const sent: { id: string; route: OutboxEntry['route'] }[] = [];
  const transport: SyncTransport = {
    async send(entry) {
      sent.push({ id: entry.id, route: entry.route });
      const answer = answers.length > 1 ? answers.shift()! : answers[0];
      return typeof answer === 'function' ? answer(entry) : answer;
    },
  };
  return { transport, sent };
}

const ok = (invoice = 'INV-000123', status: 'recorded' | 'duplicate' = 'recorded'): SendResult => ({
  httpStatus: 200,
  body: { ok: true, status, sale: { id: `sale_${invoice}`, invoiceNumber: invoice, total: 15, paidAmount: 15, changeAmount: 5, receivedAt: new Date(clock).toISOString() }, issues: [] },
});
const refusal = (httpStatus: number, code: string, retryable = false): SendResult => ({
  httpStatus,
  body: { ok: false, code, error: `${code} happened`, retryable } satisfies SyncResponse,
});
const noAnswer: SendResult = { httpStatus: null, body: null };

function engine(transport: SyncTransport) {
  const sync = new SyncEngine({ getDb: openLocalDb, transport, now: () => clock, random: () => 0, sleep: async () => undefined, withLock: (fn) => fn() });
  sync.configure(scope);
  return sync;
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await closeLocalDb();
  db = await openLocalDb();
  clock = Date.parse('2026-11-12T08:00:00Z');
});

afterEach(async () => {
  await closeLocalDb();
});

// --- At the counter ---------------------------------------------------------

test('counter: a confirmed sale is marked sent with the server’s invoice number', async () => {
  const saved = await recordSale(db, draft(), { holdUntil: SyncEngine.counterHold(clock) });
  const { transport, sent } = server(ok('INV-000001'));
  const outcome = await engine(transport).submitAtCounter(saved.id);
  assert.equal(outcome.kind, 'synced');
  assert.equal(outcome.entry.result?.invoiceNumber, 'INV-000001');
  assert.deepEqual(sent, [{ id: saved.id, route: 'checkout' }], 'a live sale goes to the server-priced checkout');
  const stored = await getEntry(db, saved.id);
  assert.equal(stored?.status, 'synced');
  assert.equal(stored?.localReceiptNumber, saved.localReceiptNumber, 'local and server numbers stay linked');
  assert.ok(await readMeta(db, META.lastSyncAt));
});

test('counter: a lost response is retried with the same id and the server’s copy is kept', async () => {
  const saved = await recordSale(db, draft());
  const { transport, sent } = server(noAnswer, ok('INV-000007', 'duplicate'));
  const outcome = await engine(transport).submitAtCounter(saved.id);
  assert.equal(outcome.kind, 'synced');
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.id === saved.id), 'every attempt carries the one id');
});

test('counter: no answer at all keeps a cash sale as PENDING SYNC, to go up as charged', async () => {
  const saved = await recordSale(db, draft());
  const { transport, sent } = server(noAnswer);
  const outcome = await engine(transport).submitAtCounter(saved.id);
  assert.equal(outcome.kind, 'pending');
  assert.equal(sent.length, 3, 'a few quick tries while the customer waits');
  const stored = await getEntry(db, saved.id);
  assert.equal(stored?.status, 'pending');
  assert.equal(stored?.route, 'sync');
  assert.ok(stored!.nextAttemptAt! > clock, 'retried later, with backoff');
});

test('counter: an unanswered GCash sale stays a live checkout (it cannot go up as an offline sale)', async () => {
  const saved = await recordSale(db, draft({ method: 'GCASH', offline: null }));
  const outcome = await engine(server(noAnswer).transport).submitAtCounter(saved.id);
  assert.equal(outcome.kind, 'pending');
  assert.equal((await getEntry(db, saved.id))?.route, 'checkout');
});

test('counter: a clear refusal declines the sale; it is kept but never sent again', async () => {
  const saved = await recordSale(db, draft());
  const outcome = await engine(server(refusal(409, 'INSUFFICIENT_STOCK')).transport).submitAtCounter(saved.id);
  assert.equal(outcome.kind, 'declined');
  if (outcome.kind === 'declined') assert.equal(outcome.code, 'INSUFFICIENT_STOCK');
  const stored = await getEntry(db, saved.id);
  assert.equal(stored?.status, 'declined');

  const { transport, sent } = server(ok());
  await engine(transport).run('manual');
  assert.equal(sent.length, 0, 'a declined sale is never uploaded');
});

test('counter: signed out before anything was sent declines; signed out after a lost attempt keeps it', async () => {
  const first = await recordSale(db, draft());
  assert.equal((await engine(server(refusal(401, 'UNAUTHORIZED')).transport).submitAtCounter(first.id)).kind, 'declined');

  const second = await recordSale(db, draft());
  const outcome = await engine(server(noAnswer, refusal(401, 'UNAUTHORIZED')).transport).submitAtCounter(second.id);
  assert.equal(outcome.kind, 'pending', 'the first attempt may have been recorded');
  assert.equal((await getEntry(db, second.id))?.status, 'reauth');
});

test('counter: rate limited every time means nothing was recorded: declined', async () => {
  const saved = await recordSale(db, draft());
  const outcome = await engine(server(refusal(429, 'RATE_LIMITED', true)).transport).submitAtCounter(saved.id);
  assert.equal(outcome.kind, 'declined');
});

// --- Background passes ------------------------------------------------------

test('a pass sends due sales oldest first and records each server invoice', async () => {
  const a = await recordSale(db, draft({ createdAt: '2026-11-12T07:00:00.000Z' }));
  const b = await recordSale(db, draft({ createdAt: '2026-11-12T07:30:00.000Z' }));
  let n = 0;
  const { transport, sent } = server(() => ok(`INV-00000${++n}`));
  await engine(transport).run('start');
  assert.deepEqual(sent.map((s) => s.id), [a.id, b.id]);
  assert.equal((await getEntry(db, a.id))?.result?.invoiceNumber, 'INV-000001');
  assert.equal((await getEntry(db, b.id))?.result?.invoiceNumber, 'INV-000002');
});

test('a pass leaves a sale the counter is still sending alone', async () => {
  await recordSale(db, draft(), { holdUntil: SyncEngine.counterHold(clock) });
  const { transport, sent } = server(ok());
  await engine(transport).run('sale');
  assert.equal(sent.length, 0);
});

test('a server error backs off and keeps the sale; no answer stops the pass', async () => {
  const a = await recordSale(db, draft({ createdAt: '2026-11-12T07:00:00.000Z' }));
  const b = await recordSale(db, draft({ createdAt: '2026-11-12T07:10:00.000Z' }));
  const c = await recordSale(db, draft({ createdAt: '2026-11-12T07:20:00.000Z' }));
  const { transport, sent } = server(refusal(503, 'DB_UNAVAILABLE', true), noAnswer, ok());
  await engine(transport).run('start');
  assert.deepEqual(sent.map((s) => s.id), [a.id, b.id], 'stopped once the server could not be reached');
  const first = await getEntry(db, a.id);
  assert.equal(first?.status, 'pending');
  assert.equal(first?.attempts, 1);
  assert.equal(first?.nextAttemptAt, clock + 2_000);
  assert.equal((await getEntry(db, c.id))?.status, 'pending', 'untouched');
});

test('a partial failure: the good sales go up, the refused one stays for review', async () => {
  const a = await recordSale(db, draft({ createdAt: '2026-11-12T07:00:00.000Z' }));
  const b = await recordSale(db, draft({ createdAt: '2026-11-12T07:10:00.000Z' }));
  const c = await recordSale(db, draft({ createdAt: '2026-11-12T07:20:00.000Z' }));
  const { transport } = server(ok('INV-1'), refusal(422, 'PRODUCT_NOT_FOUND'), ok('INV-2'));
  const sync = engine(transport);
  await sync.run('start');
  assert.equal((await getEntry(db, a.id))?.status, 'synced');
  const refused = await getEntry(db, b.id);
  assert.equal(refused?.status, 'rejected');
  assert.equal(refused?.lastError?.code, 'PRODUCT_NOT_FOUND');
  assert.equal((await getEntry(db, c.id))?.status, 'synced');
  assert.deepEqual({ pending: sync.getState().pending, attention: sync.getState().attention }, { pending: 0, attention: 1 });
});

test('an expired session stops the pass and keeps every sale until the cashier signs in', async () => {
  const a = await recordSale(db, draft());
  const b = await recordSale(db, draft());
  const { transport, sent } = server(refusal(401, 'UNAUTHORIZED'));
  await engine(transport).run('start');
  assert.equal(sent.length, 1);
  assert.equal((await getEntry(db, a.id))?.status, 'reauth');
  assert.equal((await getEntry(db, b.id))?.status, 'pending');

  // Signed in again: both go up.
  const again = server(ok());
  await engine(again.transport).run('signin');
  assert.equal(again.sent.length, 2);
  assert.equal((await getEntry(db, a.id))?.status, 'synced');
});

test('a blocked sale waits for a fresh start, not the retry timer', async () => {
  const saved = await recordSale(db, draft());
  await updateEntry(db, saved.id, (e) => ({ ...e, status: 'blocked' }));
  const timer = server(ok());
  await engine(timer.transport).run('timer');
  assert.equal(timer.sent.length, 0);
  const manual = server(ok());
  await engine(manual.transport).run('manual');
  assert.equal(manual.sent.length, 1);
});

test('another cashier’s sale is never sent under this session', async () => {
  await recordSale(db, draft({ userId: 'cashier_2' }));
  const { transport, sent } = server(ok());
  const sync = engine(transport);
  await sync.run('manual');
  assert.equal(sent.length, 0);
  assert.equal(sync.getState().othersUnsynced, 1);
});

test('two passes started together send each sale once', async () => {
  await recordSale(db, draft());
  await recordSale(db, draft());
  const { transport, sent } = server(ok());
  const sync = engine(transport);
  await Promise.all([sync.run('start'), sync.run('online'), sync.run('manual')]);
  assert.equal(sent.length, 2);
});

test('a refused sale can be tried again by hand, and is never deleted', async () => {
  const saved = await recordSale(db, draft());
  await engine(server(refusal(422, 'BRANCH_RULE')).transport).run('start');
  assert.equal((await getEntry(db, saved.id))?.status, 'rejected');
  const again = server(ok());
  await engine(again.transport).run('manual', [saved.id]);
  assert.equal((await getEntry(db, saved.id))?.status, 'synced');
});

test('with no one signed in, nothing is sent', async () => {
  await recordSale(db, draft());
  const { transport, sent } = server(ok());
  const sync = new SyncEngine({ getDb: openLocalDb, transport, now: () => clock, withLock: (fn) => fn() });
  await sync.run('start');
  assert.equal(sent.length, 0);
});
