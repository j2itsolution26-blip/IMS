'use client';

import * as React from 'react';
import { getSyncEngine } from '@/features/offline/sync-client';

/**
 * Sends the till's saved sales whenever the app is open, from any page:
 * on load, when the connection returns, when the tab comes back into view,
 * and on the engine's own retry timer. Renders nothing.
 *
 * Mounted in the signed-in layout for accounts that can sell. On sign-out it
 * stops sending but leaves every unsent sale on the device.
 */
export function SyncAgent({ storeId, userId }: { storeId: string; userId: string }) {
  React.useEffect(() => {
    const sync = getSyncEngine();
    sync.configure({ storeId, userId });
    void sync.run('start');

    const onOnline = () => void sync.run('online');
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync.run('resume');
    };
    // Background Sync: the service worker relays the browser's wake-up call.
    const onWorkerMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'SYNC_OUTBOX') void sync.run('online');
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    worker?.addEventListener('message', onWorkerMessage);
    return () => {
      worker?.removeEventListener('message', onWorkerMessage);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      sync.configure(null);
    };
  }, [storeId, userId]);

  return null;
}
