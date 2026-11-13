'use client';

import * as React from 'react';
import { openLocalDb } from '@/features/offline/local-db';
import { loadSnapshot, prepareDevice } from '@/features/offline/catalog';
import { removeOfflineAccess, revalidateEnrollments } from '@/features/offline/offline-unlock';
import { cacheOfflineTill } from '@/features/pwa/offline-till-cache';
import { catalogKey, type CatalogSnapshot } from '@/lib/offline-catalog';

/**
 * This tab's view of the offline catalogue copy, shared by the till, its
 * status chip and the offline banner.
 */

export interface CatalogState {
  key: string | null;
  /** True once the device has been read for `key`. */
  loaded: boolean;
  snapshot: CatalogSnapshot | null;
  preparing: boolean;
  lastError: string | null;
  /** Whether the owner had offline selling on, as last seen by the till. */
  offlineMode: boolean;
}

/** How old a copy may get before an online till refreshes it. */
export const CATALOG_REFRESH_MS = 10 * 60_000;

let state: CatalogState = { key: null, loaded: false, snapshot: null, preparing: false, lastError: null, offlineMode: false };
const listeners = new Set<() => void>();

function set(patch: Partial<CatalogState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getState = () => state;
const SERVER: CatalogState = { key: null, loaded: false, snapshot: null, preparing: false, lastError: null, offlineMode: false };

export function useOfflineCatalog(): CatalogState {
  return React.useSyncExternalStore(subscribe, getState, () => SERVER);
}

/** Reads the device's copy for this cashier. */
export async function loadCatalog(storeId: string, userId: string, offlineMode: boolean): Promise<void> {
  const key = catalogKey(storeId, userId);
  if (state.key !== key) set({ key, loaded: false, snapshot: null, lastError: null });
  set({ offlineMode });
  try {
    const snapshot = await loadSnapshot(await openLocalDb(), storeId, userId);
    if (state.key === key) set({ snapshot, loaded: true });
  } catch {
    if (state.key === key) set({ snapshot: null, loaded: true, lastError: 'This browser cannot store the catalogue.' });
  }
}

/**
 * Prepares or refreshes this device. Quiet unless asked (`force`): a copy
 * younger than CATALOG_REFRESH_MS is kept as it is.
 */
export async function refreshCatalog(storeId: string, userId: string, { force = false } = {}): Promise<boolean> {
  const key = catalogKey(storeId, userId);
  if (state.preparing) return false;
  if (!force && state.key === key && state.snapshot && Date.now() - Date.parse(state.snapshot.fetchedAt) < CATALOG_REFRESH_MS) return true;
  set({ key, preparing: true });
  try {
    const db = await openLocalDb();
    const result = await prepareDevice(db, { storeId, userId });
    // Online: also drop any cashier on this device the server no longer
    // allows offline (disabled, PIN changed, moved branch...). Best effort.
    void revalidateEnrollments(db).catch(() => undefined);
    if (state.key !== key) return false;
    if (result.ok) {
      set({ snapshot: result.snapshot, loaded: true, lastError: null });
      // Keeps the till page itself on the device, so it opens with no connection.
      cacheOfflineTill();
      return true;
    }
    set({ snapshot: result.withdrawn ? null : state.snapshot, lastError: result.message });
    return false;
  } catch {
    set({ lastError: 'This browser cannot store the catalogue.' });
    return false;
  } finally {
    set({ preparing: false });
  }
}

/**
 * "Remove offline access from this device": this cashier's price list and
 * offline unlock leave the device. Signing out no longer does this: the
 * device stays PIN-protected so the cashier can work offline next time.
 * Unsent sales are kept and sent at the cashier's next sign-in.
 */
export async function removeOfflineAccessHere(storeId: string, userId: string): Promise<void> {
  const key = catalogKey(storeId, userId);
  await removeOfflineAccess(await openLocalDb(), key);
  if (state.key === key) set({ snapshot: null, loaded: true, lastError: null });
}
