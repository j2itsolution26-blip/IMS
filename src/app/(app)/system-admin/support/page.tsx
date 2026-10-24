import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, Hourglass, Inbox, MessageSquareWarning, Search, Sparkles } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ADMIN_QUEUES,
  CATEGORY_INFO,
  PRIORITY_INFO,
  SUPPORT_CATEGORIES,
  SUPPORT_PAGE_SIZE,
  SUPPORT_PRIORITIES,
  parseAdminInboxQuery,
  type AdminInboxQuery,
  type AdminQueue,
  type SupportCategory,
} from '@/lib/support';
import { inboxSummary, listInbox } from '@/server/support/support-admin-service';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';
import { Panel, PanelEmpty } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PriorityBadge, StatusBadge } from '@/features/support/support-badges';

export const metadata: Metadata = { title: 'Support inbox' };
export const dynamic = 'force-dynamic';

const QUEUE_LABEL: Record<AdminQueue, string> = {
  active: 'All open',
  new: 'New',
  awaiting: 'Awaiting reply',
  waiting: 'Waiting for user',
  resolved: 'Resolved',
  closed: 'Closed',
  all: 'Everything',
};

const SELECT =
  'h-9 rounded-full border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Every support ticket on the platform, for platform administrators only
 * (`platform.view`; no store role can hold it). Counts and rows come straight
 * from the tickets, never from notifications.
 */
export default async function SupportInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const user = await requirePermission('platform.view');
  const query = parseAdminInboxQuery(await searchParams);
  const [summary, { items, total }] = await Promise.all([inboxSummary(), listInbox(query, user.id)]);
  const pageCount = Math.max(1, Math.ceil(total / SUPPORT_PAGE_SIZE));

  const link = (change: Partial<AdminInboxQuery>) => {
    const next = { ...query, page: 1, ...change };
    const params = new URLSearchParams();
    if (next.queue !== 'active') params.set('queue', next.queue);
    if (next.category) params.set('category', next.category);
    if (next.priority) params.set('priority', next.priority);
    if (next.q) params.set('q', next.q);
    if (next.sort !== 'activity') params.set('sort', next.sort);
    if (next.mine) params.set('mine', '1');
    if (next.page > 1) params.set('page', String(next.page));
    const search = params.toString();
    return search ? `/system-admin/support?${search}` : '/system-admin/support';
  };

  return (
    <>
      <PageHeader
        title="Support inbox"
        description="Concerns, bug reports and requests from store owners, staff and visitors who could not sign in."
      />

      <section aria-label="Summary" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Open tickets" value={formatNumber(summary.open, 0)} icon={Inbox} footer={{ label: 'See open', href: link({ queue: 'active' }) }} />
        <KpiCard
          label="New"
          value={formatNumber(summary.new, 0)}
          icon={Sparkles}
          tone={summary.new > 0 ? 'warning' : 'default'}
          footer={{ label: 'See new', href: link({ queue: 'new' }) }}
        />
        <KpiCard
          label="Awaiting your reply"
          value={formatNumber(summary.awaiting, 0)}
          icon={MessageSquareWarning}
          tone={summary.awaiting > 0 ? 'destructive' : 'default'}
          footer={{ label: 'Answer now', href: link({ queue: 'awaiting' }) }}
        />
        <KpiCard label="Waiting for user" value={formatNumber(summary.waiting, 0)} icon={Hourglass} footer={{ label: 'See waiting', href: link({ queue: 'waiting' }) }} />
        <KpiCard
          label="Resolved"
          value={formatNumber(summary.resolved, 0)}
          icon={CheckCircle2}
          tone="success"
          footer={{ label: 'See resolved', href: link({ queue: 'resolved' }) }}
        />
      </section>

      <Panel title="Tickets" description={`${total} ${total === 1 ? 'ticket' : 'tickets'} in “${QUEUE_LABEL[query.queue]}”`}>
        <div className="space-y-3 border-b p-4">
          <nav aria-label="Ticket queues" className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-none">
            {ADMIN_QUEUES.map((queue) => (
              <Link
                key={queue}
                href={link({ queue })}
                aria-current={query.queue === queue ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  query.queue === queue ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {QUEUE_LABEL[queue]}
              </Link>
            ))}
          </nav>
          <form action="/system-admin/support" className="flex flex-wrap items-end gap-2">
            {query.queue !== 'active' && <input type="hidden" name="queue" value={query.queue} />}
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input name="q" defaultValue={query.q} placeholder="Ticket number, subject, name, email or store" className="pl-9" aria-label="Search tickets" />
            </div>
            <select name="category" defaultValue={query.category ?? ''} aria-label="Category" className={SELECT}>
              <option value="">All categories</option>
              {SUPPORT_CATEGORIES.map((value) => (
                <option key={value} value={value}>{CATEGORY_INFO[value].label}</option>
              ))}
            </select>
            <select name="priority" defaultValue={query.priority ?? ''} aria-label="Priority" className={SELECT}>
              <option value="">Any priority</option>
              {SUPPORT_PRIORITIES.map((value) => (
                <option key={value} value={value}>{PRIORITY_INFO[value].label}</option>
              ))}
            </select>
            <select name="sort" defaultValue={query.sort} aria-label="Sort by" className={SELECT}>
              <option value="activity">Latest activity</option>
              <option value="created">Newest first</option>
              <option value="priority">Highest priority</option>
            </select>
            <label className="flex h-9 items-center gap-2 px-1 text-sm">
              <input type="checkbox" name="mine" value="1" defaultChecked={query.mine} className="h-4 w-4 accent-primary" />
              Assigned to me
            </label>
            <Button type="submit" variant="outline">Apply</Button>
          </form>
        </div>

        {items.length === 0 ? (
          <PanelEmpty
            icon={query.queue === 'awaiting' || query.queue === 'new' ? CheckCircle2 : Inbox}
            title={query.q || query.category || query.priority || query.mine ? 'No tickets match' : "You're all caught up."}
            description={
              query.q || query.category || query.priority || query.mine
                ? 'Try a different search or filter.'
                : 'New support tickets will appear here.'
            }
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <caption className="sr-only">Support tickets</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="h-10 px-4 font-semibold">Ticket</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Subject</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Requester</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Store</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Category</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Priority</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Created</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.number} className="border-b align-top last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`/system-admin/support/${row.number}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="max-w-[18rem] px-4 py-3">
                      <Link href={`/system-admin/support/${row.number}`} className="flex items-center gap-2 hover:underline">
                        {row.awaiting && <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="Awaiting reply" />}
                        <span className={cn('truncate', row.awaiting && 'font-semibold')}>{row.subject}</span>
                      </Link>
                      {row.assigneeName && <p className="text-xs text-muted-foreground">Assigned to {row.assigneeName}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p>{row.requesterName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.requesterKind === 'public' ? 'Help page (not signed in)' : row.requesterKind === 'deleted' ? 'Account deleted' : 'Signed-in account'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.storeName ?? '—'}</td>
                    <td className="px-4 py-3">{CATEGORY_INFO[row.category as SupportCategory].label}</td>
                    <td className="px-4 py-3"><PriorityBadge priority={row.priority} /></td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} audience="admin" /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      <time dateTime={row.lastActivityAt}>{formatRelative(row.lastActivityAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>Page {query.page} of {pageCount}</span>
            <div className="flex gap-1">
              {query.page > 1 ? (
                <Button asChild size="sm" variant="outline"><Link href={link({ page: query.page - 1 })}>Previous</Link></Button>
              ) : (
                <Button size="sm" variant="outline" disabled>Previous</Button>
              )}
              {query.page < pageCount ? (
                <Button asChild size="sm" variant="outline"><Link href={link({ page: query.page + 1 })}>Next</Link></Button>
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
