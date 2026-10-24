import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { SetupForm } from '@/features/setup/setup-form';
import { isSetupKeyRequired, isSetupRequired } from '@/server/platform/setup-service';

export const metadata: Metadata = { title: 'First-time setup' };
export const dynamic = 'force-dynamic';

/**
 * First-time setup: the only way the installation's first account — its
 * System Administrator — is created from a browser.
 *
 * Whether setup is open is decided here on the server from the database (no
 * COMPLETED installation row and no account), and again, atomically, by the
 * action that creates the account. Once setup is done this page only
 * redirects to sign-in.
 */
export default async function SetupPage() {
  let required: boolean;
  try {
    required = await isSetupRequired();
  } catch {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Database not reachable</h1>
          <p className="text-sm text-muted-foreground">The application could not connect to PostgreSQL.</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="mb-2 text-sm font-medium">Check that:</p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">DATABASE_URL</code> and{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">DIRECT_URL</code> are set.
            </li>
            <li>
              Migrations have been applied — run{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run db:deploy</code>.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (!required) redirect('/sign-in');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="mb-1 flex items-center gap-2 text-primary">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide">First-time setup</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome to TindahanProMax POS</h1>
        <p className="text-base font-medium">Create Your System Administrator Account</p>
        <p className="text-sm text-muted-foreground">
          This account runs the platform: it creates stores and their owners, and manages subscriptions. It can only
          be created once, here, before anyone else has an account.
        </p>
      </div>

      <SetupForm keyRequired={isSetupKeyRequired()} />
    </div>
  );
}
