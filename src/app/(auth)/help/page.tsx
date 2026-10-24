import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { getCurrentUser, userCan } from '@/lib/session';
import { SUPPORT_MAX_FILES_PUBLIC } from '@/lib/support-files';
import { issueFormToken } from '@/server/support/support-abuse';
import { TicketForm } from '@/features/support/ticket-form';
import { submitPublicTicketAction } from '@/features/support/public-actions';

export const metadata: Metadata = { title: 'Help & Support' };
export const dynamic = 'force-dynamic';

/**
 * Help for people who cannot sign in. Anyone can send a concern from here;
 * nobody can read a ticket from here. A visitor who is signed in is sent to
 * the in-app form, where the ticket is tied to their account on the server.
 */
export default async function HelpPage() {
  const user = await getCurrentUser().catch(() => null);
  if (user && !user.mustChangePassword && !user.isLocked && userCan(user, 'support.create')) {
    redirect('/support/new');
  }

  return (
    <div className="space-y-5">
      <Link
        href="/sign-in"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to sign in
      </Link>

      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">Help &amp; Support</h1>
        <p className="text-sm text-muted-foreground">
          Can&apos;t sign in, or something is not working? Send us a message and we will reply by email.
        </p>
      </div>

      <p className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span>
          Staff who forgot their password: your store owner can reset it from Settings → Users. Owners, write to us
          below.
        </span>
      </p>

      <TicketForm
        variant="public"
        compact
        action={submitPublicTicketAction}
        maxFiles={SUPPORT_MAX_FILES_PUBLIC}
        formToken={issueFormToken()}
      />
    </div>
  );
}
