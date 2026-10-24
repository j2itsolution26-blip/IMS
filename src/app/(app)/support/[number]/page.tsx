import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Lock } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { STATUS_INFO, isTicketNumber, requesterReplyEffect } from '@/lib/support';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getMyTicket, markMyTicketRead } from '@/server/support/support-service';
import { StatusBadge, categoryLabel } from '@/features/support/support-badges';
import { TicketThread } from '@/features/support/ticket-thread';
import { ReplyForm } from '@/features/support/reply-form';
import { replyToSupportTicketAction } from '@/features/support/actions';

export const metadata: Metadata = { title: 'Support ticket' };
export const dynamic = 'force-dynamic';

/**
 * One of the signed-in account's tickets. Looked up by number *and* the
 * session's account, so another account's number is simply not found.
 * Opening it marks support's replies read.
 */
export default async function SupportTicketPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requirePermission('support.create');
  const { number } = await params;
  if (!isTicketNumber(number)) notFound();
  const ticket = await getMyTicket(user.id, number);
  if (!ticket) notFound();
  await markMyTicketRead(user.id, ticket.id);

  const canReply = requesterReplyEffect(ticket.status).allowed;

  return (
    <>
      <PageHeader
        title={ticket.subject}
        breadcrumbs={[{ label: 'Support', href: '/support' }, { label: ticket.number }]}
        actions={<StatusBadge status={ticket.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-5">
          <TicketThread messages={ticket.messages} viewer="requester" />

          <Card className="rounded-card p-4 sm:p-5">
            {canReply ? (
              <ReplyForm
                viewer="requester"
                action={replyToSupportTicketAction.bind(null, ticket.number)}
                hint={ticket.status === 'RESOLVED' ? 'Replying reopens this ticket.' : undefined}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  This ticket is closed and cannot take new replies. If you still need help, open a new ticket.
                </p>
                <Button asChild size="sm">
                  <Link href={`/support/new?category=${ticket.category}`}>Open a new ticket</Link>
                </Button>
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <Card className="rounded-card p-4">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Ticket number</dt>
                <dd className="font-mono font-semibold">{ticket.number}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>{STATUS_INFO[ticket.status].requesterHint}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd>{categoryLabel(ticket.category)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted</dt>
                <dd><time dateTime={ticket.createdAt}>{formatDateTime(ticket.createdAt)}</time></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last updated</dt>
                <dd><time dateTime={ticket.lastActivityAt}>{formatDateTime(ticket.lastActivityAt)}</time></dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}
