'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { SERVICE_WORKER_URL } from '@/lib/pwa';
// Imported for its side effect: attaches the install-prompt listeners as early
// as possible, since the browser fires that event only once.
import '@/features/pwa/install-state';

/** Long-open POS tabs check for a new version at most this often. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers public/sw.js and offers updates.
 *
 * Production only: in development a worker would serve stale bundles over hot
 * reload. Service workers also need a secure context (HTTPS or localhost).
 *
 * A new version waits until the user taps "Reload", so an update never
 * reloads the POS in the middle of a sale.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    let disposed = false;
    let updateAccepted = false;
    let lastCheck = Date.now();
    let registration: ServiceWorkerRegistration | undefined;

    const offerUpdate = (worker: ServiceWorker) => {
      toast('A new version of TindahanProMax is ready', {
        id: 'app-update',
        description: 'Reload when you are between sales.',
        duration: Infinity,
        action: {
          label: 'Reload',
          onClick: () => {
            updateAccepted = true;
            worker.postMessage({ type: 'SKIP_WAITING' });
          },
        },
      });
    };

    // Fires on first install too (the worker claims the page); only an update
    // the user accepted should reload it.
    const onControllerChange = () => {
      if (updateAccepted) window.location.reload();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      registration?.update().catch(() => undefined);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (disposed) return;
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(installing);
          });
        });
      })
      .catch((error: unknown) => console.warn('[pwa] service worker registration failed', error));

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return null;
}
