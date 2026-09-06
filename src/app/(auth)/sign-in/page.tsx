import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Boxes } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { SignInForm } from '@/features/auth/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * Determines whether the system has been set up yet.
 *
 * With no accounts, the only sensible destination is the owner-creation flow
 * — there is nothing to sign in to yet — so this redirects there rather than
 * showing a login page nobody can pass. `null` means the database could not
 * be reached at all, in which case we fall back to showing the ordinary form
 * and let the sign-in attempt itself surface the real error.
 */
async function countUsers(): Promise<number | null> {
  try {
    return await prisma.user.count();
  } catch {
    return null;
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const [{ next, reason }, userCount] = await Promise.all([searchParams, countUsers()]);

  // Brand-new system: no accounts exist yet, so there is no login to show.
  // The server — not a client-side check — decides this, and it is re-verified
  // independently inside the sign-up flow itself (see src/lib/auth.ts).
  if (userCount === 0) {
    redirect('/sign-up');
  }

  // Set by /api/session/reset after clearing a cookie that could no longer be
  // verified. Saying so beats letting the user wonder why they were signed out.
  const sessionExpired = reason === 'session-expired';

  return (
    <div className="space-y-8">
      {/* ── Brand header ── */}
      <div className="space-y-2">
        <div className="mb-6 flex items-center gap-2.5 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Boxes className="h-4.5 w-4.5" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            Point of Sale
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to access your inventory dashboard.
        </p>
      </div>

      {/* ── Signed-out notice ── */}
      {sessionExpired && (
        <div
          role="status"
          className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"
        >
          <p className="font-medium">Your session has ended</p>
          <p className="mt-1 opacity-90">
            You have been signed out because your session could no longer be verified. Signing in
            again will fix it.
          </p>
        </div>
      )}

      {/* ── Sign-in form ── */}
      <SignInForm redirectTo={next ?? '/dashboard'} />
    </div>
  );
}
