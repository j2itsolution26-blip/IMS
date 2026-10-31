'use client';

import { BrandLogo } from '@/components/brand';
import { LockScreen } from '@/features/auth/lock-screen';
import type { UnlockMethod } from '@/lib/pos-pin';

export function LockedView({
  name,
  username,
  initialMethods,
  destination,
}: {
  name: string;
  username: string;
  initialMethods: UnlockMethod[];
  destination: string;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-4">
      <BrandLogo priority sizes="160px" className="w-[140px] sm:w-[160px]" />
      <LockScreen
        name={name}
        username={username}
        initialMethods={initialMethods}
        // Full navigation so every server component re-reads the now-unlocked session.
        onUnlocked={() => {
          window.location.href = destination;
        }}
      />
    </main>
  );
}
