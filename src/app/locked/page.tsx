import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { allowedUnlockMethods } from '@/lib/pos-pin';
import { isSafeReturnPath } from '@/lib/safe-path';
import { LockedView } from '@/features/auth/locked-view';

export const metadata: Metadata = { title: 'Screen locked' };
export const dynamic = 'force-dynamic';

/**
 * Where a locked session lands when a page is loaded fresh (a refresh, a new
 * tab). Renders nothing from the store — only who is signed in and the unlock
 * form — and returns to the page that was asked for once unlocked.
 */
export default async function LockedPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, user] = await Promise.all([searchParams, getCurrentUser()]);
  const destination = isSafeReturnPath(next) && !next.startsWith('/locked') ? next : '/dashboard';

  if (!user) redirect('/api/session/reset');
  if (!user.isLocked) redirect(destination);

  const session = await prisma.session.findUnique({
    where: { id: user.sessionId },
    select: { unlockFailures: true },
  });

  return (
    <LockedView
      name={user.name}
      username={user.username}
      initialMethods={allowedUnlockMethods(user.hasPin, session?.unlockFailures ?? 0)}
      destination={destination}
    />
  );
}
