import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEntry, describeSyncStatus } from '@/features/offline/sync-status-model';
import type { SyncState } from '@/features/offline/sync-engine';

const base: SyncState = { available: true, syncing: false, reachable: true, lastSyncAt: null, lastError: null, pending: 0, attention: 0, othersUnsynced: 0 };
const label = (patch: Partial<SyncState>, online = true) => describeSyncStatus({ ...base, ...patch }, online).label;

test('the sync indicator names each state', () => {
  assert.equal(label({}), 'Online · Synced');
  assert.equal(label({ pending: 3 }), 'Online · 3 pending');
  assert.equal(label({ pending: 3, syncing: true }), 'Synchronizing');
  assert.equal(label({ attention: 2, pending: 1 }), 'Sync error · 2');
  assert.equal(label({}, false), 'Offline');
  assert.equal(label({ pending: 1 }, false), 'Offline · 1 pending');
  assert.equal(label({ available: false }), 'Not saving on device');
});

test('before the device has been read, it never claims to be synced', () => {
  assert.equal(label({ available: null }), 'Checking…');
});

test('"online" needs the server, not just a network: an unreachable server reads as offline', () => {
  assert.equal(label({ reachable: false }, true), 'Offline');
});

test('a refused sale says why and that it is kept', () => {
  const text = describeEntry({ status: 'rejected', nextAttemptAt: null, lastError: { code: 'X', message: 'Product missing', at: '' } });
  assert.match(text, /Product missing/);
  assert.match(text, /stays here/);
});

test('a waiting sale says when it is tried next', () => {
  const now = 1_000_000;
  assert.match(describeEntry({ status: 'pending', nextAttemptAt: now + 30_000, lastError: null }, now), /Next try in 30s/);
  assert.match(describeEntry({ status: 'pending', nextAttemptAt: now + 180_000, lastError: null }, now), /Next try in 3 min/);
});
