import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Boxes, ShieldCheck } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { SignUpForm } from '@/features/auth/sign-up-form';

export const metadata: Metadata = { title: 'Create owner account' };
export const dynamic = 'force-dynamic';

/**
 * First-run setup only.
 *
 * This page exists so the very first Owner account can be created without
 * shipping a seeded admin with a known password. Once any account exists it
 * redirects away, and the server rejects the sign-up regardless — new staff are
 * added from Settings → Users.
 */
export default async function SignUpPage() {
  let userCount: number;
  try {
    userCount = await prisma.user.count();
  } catch {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Boxes className="h-4.5 w-4.5" />
            </span>
            <span className="text-base font-semibold tracking-tight">
              Inventory Management System
            </span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">
            Database not reachable
          </h1>
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

  if (userCount > 0) redirect('/sign-in');

  const roleCount = await prisma.role.count();
  if (roleCount === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Boxes className="h-4.5 w-4.5" />
            </span>
            <span className="text-base font-semibold tracking-tight">
              Inventory Management System
            </span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">
            Finish the database setup
          </h1>
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
        <div className="mb-6 flex items-center gap-2.5 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Boxes className="h-4.5 w-4.5" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            Inventory Management System
          </span>
        </div>

        <div className="mb-1 flex items-center gap-2 text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            First-Run Setup
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          Create the owner account
        </h1>
        <p className="text-sm text-muted-foreground">
          This account gets full access. Everyone else is added from Settings →
          Users.
        </p>
      </div>

      {/* ── Sign-up form ── */}
      <SignUpForm />

      {/* ── Link back ── */}
      <p className="text-center text-xs text-muted-foreground">
        Already set up?{' '}
        <Link
          href="/sign-in"
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
