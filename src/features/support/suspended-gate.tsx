'use client';

import { usePathname } from 'next/navigation';
import { isSupportPath } from '@/lib/support';

/**
 * While a store is suspended, every page shows the suspension notice except
 * Support, which the notice itself points to. Decided from the current path
 * on the client, because a layout is not re-rendered on client navigation.
 * This only chooses what to show: the pages themselves are still refused on
 * the server, since every store query rejects a suspended store.
 */
export function SuspendedGate({ notice, children }: { notice: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  return <>{isSupportPath(pathname) ? children : notice}</>;
}
