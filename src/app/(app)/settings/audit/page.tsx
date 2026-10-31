import type { Metadata } from 'next';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { AUDIT_ACTION_LABEL, AUDIT_CATEGORIES, auditWindowLabel, parseAuditCategory, type AuditCategory } from '@/lib/audit-log';
import { formatDateTime, formatNumber } from '@/lib/format';
import { listAuditActors, listStoreAudit } from '@/server/services/audit-queries';
import { PageHeader } from '@/components/page-header';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Activity Log' };
export const dynamic = 'force-dynamic';

/**
 * The store's activity log: who did what and when, read-only. How far back
 * it reaches is the plan's audit history, applied on the server by
 * listStoreAudit; older entries are kept, just not shown.
 */
export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; staff?: string; page?: string }>;
}) {
  const user = await requirePermission('audit.view');
  const params = await searchParams;
  const ctx = await getStoreContext();
  const days = ctx.access.plan.auditHistoryDays;

  const [result, actors] = await Promise.all([
    listStoreAudit({
      category: parseAuditCategory(params.category),
      userId: params.staff || null,
      search: params.q,
      page: Number(params.page) || 1,
    }),
    listAuditActors(),
  ]);

  return (
    <>
      <PageHeader
        title="Activity Log"
        description={`Who did what in your store, newest first. Your ${ctx.access.plan.name} plan shows ${auditWindowLabel(days)}.`}
      />

      {result.hiddenOlder > 0 && (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {formatNumber(result.hiddenOlder, 0)} older {result.hiddenOlder === 1 ? 'entry is' : 'entries are'} kept but not
          shown on your plan. Nothing is deleted.
          {userCan(user, 'billing.view') && (
            <>
              {' '}
              <Link href="/settings/subscription" className="font-medium text-foreground underline-offset-4 hover:underline">
                See plans with longer history
              </Link>
            </>
          )}
        </p>
      )}

      <FilterBar
        searchPlaceholder="Search the activity…"
        selects={[
          {
            name: 'category',
            label: 'Activity',
            allLabel: 'All activity',
            width: 'w-[210px]',
            options: (Object.keys(AUDIT_CATEGORIES) as AuditCategory[]).map((key) => ({ value: key, label: AUDIT_CATEGORIES[key].label })),
          },
          {
            name: 'staff',
            label: 'Person',
            allLabel: 'Everyone',
            width: 'w-[170px]',
            options: actors.map((actor) => ({ value: actor.id, label: actor.name })),
          },
        ]}
      />

      <div className="overflow-hidden rounded-card border bg-card shadow-card">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No activity found"
            description="Sales, refunds, voids, cash movements, stock changes, staff changes and billing all appear here."
          />
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-thin">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">When</TableHead>
                    <TableHead scope="col">Activity</TableHead>
                    <TableHead scope="col">What happened</TableHead>
                    <TableHead scope="col">By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{AUDIT_ACTION_LABEL[row.action]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.summary}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {row.actorName ?? 'System'}
                        {row.actorUsername && <span className="block text-xs">@{row.actorUsername}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
