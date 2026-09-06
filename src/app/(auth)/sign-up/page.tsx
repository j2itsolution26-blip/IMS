import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, CheckCircle2, ShieldCheck } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { SignUpForm } from '@/features/auth/sign-up-form';

export const metadata: Metadata = { title: 'Create owner account' };
export const dynamic = 'force-dynamic';

/** Small brand lockup repeated at the top of every state this page can render. */
function BrandHeader() {
  return (
    <div className="mb-6 flex items-center gap-2.5 lg:hidden">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Boxes className="h-4.5 w-4.5" />
      </span>
      <span className="text-base font-semibold tracking-tight">Point of Sale</span>
    </div>
  );
}

/** Primary-button-styled link, matching the sign-in page's "Create Owner Account" CTA. */
function BackToSignIn() {
  return (
    <Link
      href="/sign-in"
      className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      Back to Sign In
    </Link>
  );
}

/**
 * First-run setup only.
 *
 * This page exists so the very first Owner account can be created without
 * shipping a seeded admin with a known password. This is enforced twice: here
 * (so a direct visit gets a clear message instead of a silent bounce) and
 * again, atomically, inside the `user.create` database hook in `src/lib/auth.ts`
 * — that second check is the one that actually matters, since the UI alone can
 * never be trusted to keep a second Owner from being created (e.g. two people
 * opening this page at the same moment, or a direct API request).
 */
export default async function SignUpPage() {
  let userCount: number;
  try {
    userCount = await prisma.user.count();
  } catch {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <BrandHeader />
          <h1 className="text-2xl font-bold tracking-tight">Database not reachable</h1>
          <p className="text-sm text-muted-foreground">
            The application could not connect to PostgreSQL.
          </p>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="mb-2 text-sm font-medium">Check that:</p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">DATABASE_URL</code> and{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">DIRECT_URL</code> are
              set.
            </li>
            <li>
              Migrations have been applied — run{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run db:deploy</code>.
            </li>
            <li>
              The role catalogue is installed — run{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run db:bootstrap</code>.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  // An Owner account already exists (in this system, "any account exists" and
  // "an Owner exists" are the same fact — see `resolveRoleIdForNewUser` in
  // `src/lib/auth.ts`: the first account is always the Owner, public sign-up
  // is closed the instant it's created, and an active Owner can never be
  // deleted or demoted below one). Refuse outright rather than redirecting
  // silently, so a direct visit to this URL gets an explicit answer.
  if (userCount > 0) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <BrandHeader />
          <div className="mb-1 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Setup complete</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Owner account has already been created.
          </h1>
          <p className="text-sm text-muted-foreground">
            This one-time setup can only run once. Sign in with the Owner account, or ask an
            administrator to create your account from Settings → Users.
          </p>
        </div>

        <BackToSignIn />
      </div>
    );
  }

  const roleCount = await prisma.role.count();
  if (roleCount === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <BrandHeader />
          <h1 className="text-2xl font-bold tracking-tight">Finish the database setup</h1>
          <p className="text-sm text-muted-foreground">
            Roles and permissions have not been installed yet.
          </p>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p>
            Run{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run db:bootstrap</code>{' '}
            to install the role and permission catalogue, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Brand header ── */}
      <div className="space-y-2">
        <BrandHeader />

        <div className="mb-1 flex items-center gap-2 text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">First-Run Setup</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          Set up your Inventory Management System
        </h1>
        <p className="text-sm text-muted-foreground">
          Create the primary Owner account to get started. This account gets full access —
          everyone else is added later from Settings → Users.
        </p>
      </div>

      {/* ── Sign-up form ── */}
      <SignUpForm />

      {/* ── Link back ── */}
      <p className="text-center text-xs text-muted-foreground">
        Already set up?{' '}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
