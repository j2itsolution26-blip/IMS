import type * as React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { SetupForm } from '@/features/setup/setup-form';
import { getSetupStatus, isSetupKeyRequired } from '@/server/platform/setup-service';

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
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function Problem({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="mb-1 flex items-center gap-2 text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide">Setup can&apos;t start yet</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export default async function SetupPage() {
  const status = await getSetupStatus();

  if (status === 'closed') redirect('/sign-in');

  if (status === 'needs-migrations') {
    return (
      <Problem
        title="The database needs its tables"
        lead="This database is reachable, but its tables have not been created yet (or are out of date). A new database starts like this: deploying the app does not create them."
      >
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            On your computer, in the project folder, make sure <Code>DATABASE_URL</Code> and <Code>DIRECT_URL</Code> in{' '}
            <Code>.env</Code> point at <strong>this</strong> database.
          </li>
          <li>
            Run <Code>npx prisma migrate deploy</Code>, then <Code>npx prisma migrate status</Code> — it should say the
            schema is up to date.
          </li>
          <li>Reload this page. Setup will start; nothing needs to be created by hand.</li>
        </ol>
      </Problem>
    );
  }

  if (status === 'unreachable') {
    return (
      <Problem title="Database not reachable" lead="The application could not connect to PostgreSQL.">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Check that <Code>DATABASE_URL</Code> and <Code>DIRECT_URL</Code> are set for this deployment and point at a
            running database.
          </li>
          <li>On Vercel, change them under Settings → Environment Variables, then redeploy.</li>
          <li>If the database was just created or resumed, wait a minute and reload.</li>
        </ul>
      </Problem>
    );
  }

  if (status === 'failed') {
    return (
      <Problem title="Setup could not check the database" lead="Something unexpected went wrong. The details are in the server log.">
        <p>Reload the page. If it keeps happening, check the deployment&apos;s logs for a line starting with <Code>[setup]</Code>.</p>
      </Problem>
    );
  }

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
