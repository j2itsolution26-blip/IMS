import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, LifeBuoy, Plus } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { formatDate, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SUPPORT_PAGE_SIZE, parseRequesterFilter, type RequesterFilter } from '@/lib/support';
import { PageHeader } from '@/components/page-header';
import { Panel, PanelEmpty } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { listMyTickets } from '@/server/support/support-service';
import { StatusBadge, categoryLabel } from '@/features/support/support-badges';

export const metadata: Metadata = { title: 'Support' };
export const dynamic = 'force-dynamic';

const FILTERS: { value: RequesterFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING_FOR_USER', label: 'Waiting for you' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

/**
 * The signed-in account's own support tickets — nobody else's, owners
 * included (staff concerns stay private). Read by requester id from the
 * session, so no URL can show another account's tickets.
 */
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const user = await requirePermission('support.create');
  const params = await searchParams;
  const filter = parseRequesterFilter(params.status);
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));
  const { items, total, counts } = await listMyTickets(user.id, filter, page);
  const pageCount = Math.max(1, Math.ceil(total / SUPPORT_PAGE_SIZE));
  const everything = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const countFor = (value: RequesterFilter) =>
    value === 'all' ? everything : value === 'OPEN' ? counts.NEW + counts.OPEN : counts[value];
  const href = (next: { status?: RequesterFilter; page?: number }) => {
    const search = new URLSearchParams();
    const status = next.status ?? filter;
    if (status !== 'all') search.set('status', status);
    if ((next.page ?? 1) > 1) search.set('page', String(next.page));
    const query = search.toString();
    return query ? `/support?${query}` : '/support';
  };

  return (
    <>
      <PageHeader
        title="Support"
        description="Ask a question, report a problem, or suggest an idea. Our team replies here."
        actions={
          <Button asChild>
            <Link href="/support/new">
              <Plus aria-hidden="true" /> New ticket
            </Link>
          </Button>
        }
      />

      <nav aria-label="Filter tickets" className="-mx-1 mb-4 overflow-x-auto px-1">
        <ul className="flex w-max gap-1.5">
          {FILTERS.map((option) => {
            const active = option.value === filter;
            return (
              <li key={option.value}>
                <Link
                  href={href({ status: option.value })}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent',
                  )}
                >
                  {option.label}
                  <span className={cn('tabular-nums text-xs', active ? 'opacity-80' : 'text-muted-foreground')}>
                    {countFor(option.value)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Panel title="My tickets" description={total === 1 ? '1 ticket' : `${total} tickets`}>
        {items.length === 0 ? (
          <PanelEmpty
            icon={LifeBuoy}
            title={everything === 0 ? 'No support tickets yet' : "You're all caught up."}
            description={
              everything === 0
                ? 'When something is not working, or you have an idea, tell us here.'
                : 'No tickets match this filter.'
            }
            action={
              everything === 0 ? (
                <Button asChild size="sm">
                  <Link href="/support/new">Contact support</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y">
            {items.map((ticket) => (
              <li key={ticket.number}>
                <Link
                  href={`/support/${ticket.number}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none md:grid-cols-[7rem_1fr_10rem_8rem_9rem_auto]"
                >
                  <span className="font-mono text-xs text-muted-foreground md:text-sm">{ticket.number}</span>
                  <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 md:col-span-1 md:row-start-auto">
                    {ticket.unreadReply && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="New reply" />
                    )}
                    <span className={cn('truncate text-sm', ticket.unreadReply ? 'font-semibold' : 'font-medium')}>
                      {ticket.subject}
                    </span>
                  </span>
                  <span className="hidden truncate text-sm text-muted-foreground md:block">{categoryLabel(ticket.category)}</span>
                  <span className="hidden text-xs text-muted-foreground md:block">
                    <time dateTime={ticket.createdAt}>{formatDate(ticket.createdAt)}</time>
                  </span>
                  <span className="col-span-2 row-start-3 text-xs text-muted-foreground md:col-span-1 md:row-start-auto">
                    Updated <time dateTime={ticket.lastActivityAt}>{formatRelative(ticket.lastActivityAt)}</time>
                    {ticket.unreadReply && <span className="font-medium text-primary md:hidden"> · New reply</span>}
                  </span>
                  <span className="col-start-2 row-start-1 flex items-center gap-1 justify-self-end md:col-start-auto md:row-start-auto">
                    <StatusBadge status={ticket.status} />
                    <ChevronRight className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              Page {page} of {pageCount}
            </span>
            <div className="flex gap-1">
              {page > 1 ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={href({ page: page - 1 })}>Previous</Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>Previous</Button>
              )}
              {page < pageCount ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={href({ page: page + 1 })}>Next</Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>Next</Button>
              )}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
