'use client';

import * as React from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/**
 * The browser's connection state. "Offline" is reliable; "online" only means
 * a network is attached, so server calls must still handle failure.
 * Assumed online on the server so the first render matches.
 */
export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
