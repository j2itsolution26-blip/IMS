'use client';

import * as React from 'react';
import { openLocalDb } from '@/features/offline/local-db';
import { SyncEngine, httpTransport, type SyncState } from '@/features/offline/sync-engine';

/**
 * The one sync engine for this tab, and the hook the UI reads it through.
 * Other tabs of the app are told over a BroadcastChannel when this one
 * changes the outbox, and refresh their counts.
 */

const CHANNEL = 'tpm-pos-outbox';

let engine: SyncEngine | null = null;
let channel: BroadcastChannel | null = null;

export function getSyncEngine(): SyncEngine {
  if (engine) return engine;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => void engine?.refresh();
  }
  engine = new SyncEngine({
    getDb: openLocalDb,
    transport: httpTransport(),
    onDatabaseChange: () => channel?.postMessage('changed'),
  });
  return engine;
}

/** Tells the other tabs the outbox changed (after a write outside the engine). */
export function announceOutboxChange(): void {
  channel?.postMessage('changed');
}

const SERVER_STATE: SyncState = {
  available: null,
  syncing: false,
  reachable: null,
  lastSyncAt: null,
  lastError: null,
  pending: 0,
  attention: 0,
  othersUnsynced: 0,
};

const noSubscribe = () => () => undefined;
const serverState = () => SERVER_STATE;

export function useSyncState(): SyncState {
  // Never made during server rendering: the engine belongs to one browser tab.
  const sync = typeof window === 'undefined' ? null : getSyncEngine();
  return React.useSyncExternalStore(sync?.subscribe ?? noSubscribe, sync?.getState ?? serverState, serverState);
}
