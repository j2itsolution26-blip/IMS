import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Lock } from 'lucide-react';
import { platformPrisma } from '@/lib/prisma';
import { SignInForm } from '@/features/auth/sign-in-form';
import { InstallAppLink } from '@/features/pwa/install-app-link';
import { passkeyConfig } from '@/lib/auth';
import { passkeysAvailableAt } from '@/lib/passkey-config';
import { requestOrigin } from '@/lib/request-origin';

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
    return await platformPrisma.user.count();
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
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to your TindahanProMax account.
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
      <SignInForm
        redirectTo={next ?? '/dashboard'}
        passkeysEnabled={passkeysAvailableAt(passkeyConfig, await requestOrigin())}
      />

      {/* There is no self-service recovery: owners reset staff passwords. */}
      <div className="space-y-3 border-t pt-5 text-center text-xs text-muted-foreground">
        <p>Forgot your password? Ask your store owner to reset it.</p>
        <p className="flex items-center justify-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Secure access &bull; Only authorized staff can sign in
        </p>
        <InstallAppLink />
      </div>
    </div>
  );
}
