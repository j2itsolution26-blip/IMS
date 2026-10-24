import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Lock } from 'lucide-react';
import { getSetupStatus } from '@/server/platform/setup-service';
import { SignInForm } from '@/features/auth/sign-in-form';
import { InstallAppLink } from '@/features/pwa/install-app-link';
import { passkeyConfig } from '@/lib/auth';
import { passkeysAvailableAt } from '@/lib/passkey-config';
import { requestOrigin } from '@/lib/request-origin';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * Whether this page should hand over to /setup: setup is still open, or the
 * database has no tables yet (a new database before its migrations), in which
 * case /setup explains what to run instead of showing a login nobody can
 * pass. If the database cannot be reached at all the ordinary form shows, and
 * the sign-in attempt itself reports it.
 */
async function setupPending(): Promise<boolean> {
  const status = await getSetupStatus();
  return status === 'required' || status === 'needs-migrations';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string; setup?: string }>;
}) {
  const [{ next, reason, setup }, pending] = await Promise.all([searchParams, setupPending()]);

  // Brand-new installation: create the System Administrator first. Decided on
  // the server, and re-checked atomically by the setup action itself.
  if (pending) {
    redirect('/setup');
  }
  const setupDone = setup === 'done';

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

      {setupDone && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success-text">
          <p className="font-medium">Setup complete</p>
          <p className="mt-1 opacity-90">Sign in with your new System Administrator account.</p>
        </div>
      )}

      {/* ── Signed-out notice ── */}
      {sessionExpired && (
        <div
          role="status"
          className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-text"
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
