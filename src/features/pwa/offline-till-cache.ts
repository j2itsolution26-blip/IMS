'use client';

import { SERVICE_WORKER_URL } from '@/lib/pwa';

/**
 * Asks the service worker (public/sw.js) to keep the offline till page and
 * the build files it needs, so a prepared device can open the till with no
 * connection. The page holds no account data: it reads the device's own
 * catalogue copy. Best effort; does nothing without a service worker.
 */
export function cacheOfflineTill(): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // `ready` waits for an active worker, so a till prepared on its very first
    // visit, before the worker finished installing, is still kept. (Never
    // settles in development, where no worker is registered.)
    void navigator.serviceWorker.ready
      .then((registration) => registration.active?.postMessage({ type: 'CACHE_OFFLINE_TILL' }))
      .catch(() => undefined);
  } catch {
    // No service worker here: the till still sells offline while it stays open.
  }
}

/**
 * Asks the browser to wake the app to send saved sales once the connection
 * returns (Background Sync, where supported: Chromium browsers). The service
 * worker relays it to the open app, whose sync engine does the sending.
 */
export function requestBackgroundSync(): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker
      .getRegistration(SERVICE_WORKER_URL)
      .then((registration) => (registration as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | undefined)?.sync?.register('tpm-outbox'))
      .catch(() => undefined);
  } catch {
    // Not supported: the app sends when it sees the connection return.
  }
}
