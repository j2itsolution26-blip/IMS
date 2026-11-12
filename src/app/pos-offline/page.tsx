import type { Metadata } from 'next';
import { OfflineTill } from '@/features/offline/offline-till';

export const metadata: Metadata = { title: 'Offline till' };
// The same HTML for everyone, with no account data in it: the service worker
// keeps it on prepared devices, and the till reads everything it shows from
// the device's own copy (src/features/offline).
export const dynamic = 'force-static';

export default function OfflineTillPage() {
  return <OfflineTill />;
}
