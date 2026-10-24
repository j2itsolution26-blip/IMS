import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mail, Store } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { CATEGORY_INFO, isTicketNumber, type SupportCategory } from '@/lib/support';
import { getTicketForAdmin, listAssignableAdmins } from '@/server/support/support-admin-service';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { PriorityBadge, StatusBadge } from '@/features/support/support-badges';
import { TicketThread } from '@/features/support/ticket-thread';
import { ReplyForm } from '@/features/support/reply-form';
import { TicketAdminPanel } from '@/features/support/ticket-admin-panel';
import { adminNoteAction, adminReplyAction } from '@/features/support/admin-actions';

export const metadata: Metadata = { title: 'Support ticket' };
export const dynamic = 'force-dynamic';

/** One ticket in full for a platform administrator: the conversation with internal notes, and its history. */
export default async function AdminSupportTicketPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requirePermission('platform.view');
  const canManage = userCan(user, 'platform.manage');
  const { number } = await params;
  if (!isTicketNumber(number)) notFound();
  const [ticket, admins] = await Promise.all([getTicketForAdmin(number), listAssignableAdmins()]);
  if (!ticket) notFound();

  const closed = ticket.status === 'CLOSED';
  const mailto = ticket.requester.replyEmail
    ? `mailto:${encodeURIComponent(ticket.requester.replyEmail)}?subject=${encodeURIComponent(`[${ticket.number}] ${ticket.subject}`)}`
    : null;

  return (
    <>
      <PageHeader
        title={ticket.subject}
        breadcrumbs={[{ label: 'Support inbox', href: '/system-admin/support' }, { label: ticket.number }]}
        actions={
          <>
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} audience="admin" />
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {ticket.source === 'PUBLIC' && (
            <p role="note" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              Sent from the Help page by someone who was not signed in. Replies here are not emailed: answer at{' '}
              {mailto ? (
                <a href={mailto} className="font-semibold underline underline-offset-4">{ticket.requester.replyEmail}</a>
              ) : (
                'the address they gave'
              )}
              , and record what you sent as an internal note. Do not reveal account details until you have verified who they are.
            </p>
          )}

          <TicketThread messages={ticket.messages} viewer="admin" />

          {canManage && (
            <Card className="rounded-card p-4 sm:p-5">
              {closed ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">This ticket is closed. Reopen it to reply; you can still add an internal note.</p>
                  <ReplyForm viewer="admin" notesOnly action={adminNoteAction.bind(null, ticket.number)} noteAction={adminNoteAction.bind(null, ticket.number)} />
                </div>
              ) : (
                <ReplyForm
                  viewer="admin"
                  action={adminReplyAction.bind(null, ticket.number)}
                  noteAction={adminNoteAction.bind(null, ticket.number)}
                />
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="rounded-card p-4">
            <TicketAdminPanel
              number={ticket.number}
              status={ticket.status}
              priority={ticket.priority}
              assigneeId={ticket.assignee?.id ?? null}
              admins={admins}
              canManage={canManage}
            />
          </Card>

          <Card className="rounded-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Requester</h2>
            <dl className="space-y-2.5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd>{ticket.requester.name}</dd>
              </div>
              {ticket.source === 'APP' ? (
                ticket.requester.username ? (
                  <>
                    <div>
                      <dt className="text-xs text-muted-foreground">Account</dt>
                      <dd>
                        @{ticket.requester.username}
                        {ticket.requester.roleName ? ` · ${ticket.requester.roleName}` : ''}
                        {ticket.requester.active === false ? ' · deactivated' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd className="break-all">{ticket.requester.email}</dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt className="text-xs text-muted-foreground">Account</dt>
                    <dd>Deleted</dd>
                  </div>
                )
              ) : (
                <div>
                  <dt className="text-xs text-muted-foreground">Reply to</dt>
                  <dd className="flex items-center gap-1.5 break-all">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {mailto ? <a href={mailto} className="hover:underline">{ticket.requester.replyEmail}</a> : '—'}
                  </dd>
                </div>
              )}
              {ticket.store && (
                <div>
                  <dt className="text-xs text-muted-foreground">Store</dt>
                  <dd>
                    <Link href={`/system-admin/stores/${ticket.store.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <Store className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {ticket.store.name}
                    </Link>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd>{CATEGORY_INFO[ticket.category as SupportCategory].label}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted</dt>
                <dd><time dateTime={ticket.createdAt}>{formatDateTime(ticket.createdAt)}</time></dd>
              </div>
            </dl>
          </Card>

          <Card className="rounded-card p-4">
            <h2 className="mb-3 text-sm font-semibold">History</h2>
            {ticket.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No administrative changes yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {ticket.history.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <p>{entry.summary}</p>
                    <p className="text-muted-foreground">
                      {entry.actorName ?? 'Unknown'} · <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
