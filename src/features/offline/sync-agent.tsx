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
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      sync.configure(null);
    };
  }, [storeId, userId]);

  return null;
}
