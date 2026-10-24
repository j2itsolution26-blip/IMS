import type { Metadata } from 'next';
import Link from 'next/link';
import { Banknote, CircleCheck, Lock, PlayCircle, TriangleAlert, Vault, Wallet, Coins } from 'lucide-react';
import { requireUser, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { formatCurrency } from '@/lib/format';
import { inlineLabel } from '@/server/analytics/date-range';
import { getShiftKpis, listShifts } from '@/server/services/shift-service';
import { syncOverdueShiftNotifications } from '@/server/services/notification-service';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { EmptyState } from '@/components/empty-state';
import { KpiCard } from '@/components/kpi-card';
import { resolveShiftQuery, type ShiftSearchParams } from '@/features/shifts/params';
import { ShiftMonitorTable } from '@/features/shifts/shift-monitor-table';
import { ShiftExportMenu } from '@/features/shifts/shift-export-menu';
import { AutoRefresh } from '@/features/shifts/auto-refresh';
import { PlanGate } from '@/features/subscription/plan-gate';

export const metadata: Metadata = { title: 'Shift Management' };
export const dynamic = 'force-dynamic';

/**
 * Shift Management — the owner's view of every cashier's drawer.
 *
 * Gated on the owner's financial permission, checked here on the server
 * before any shift data is read; the sidebar entry uses the same key, so
 * cashiers neither see the link nor reach the data. Figures come from the
 * shift service: live for open shifts, frozen at close for closed ones.
 */
export default async function ShiftManagementPage({ searchParams }: { searchParams: Promise<ShiftSearchParams> }) {
  const user = await requireUser();
  if (!userCan(user, FINANCIAL_PERMISSION)) {
    return (
      <EmptyState
        icon={Lock}
        title="Shift Management is for the store owner"
        description="It shows every cashier's drawer counts. Your own shift is on your dashboard and at the POS."
      />
    );
  }

  const params = await searchParams;
  const { query, period, range, custom, cashiers } = await resolveShiftQuery(params);
  // Raise any "left open" notices before reading, so the bell agrees with the table.
  await syncOverdueShiftNotifications().catch((error) => console.error('[shifts] overdue check failed', error));
  const [kpis, result, currency] = await Promise.all([getShiftKpis(), listShifts(query), getCurrency()]);
  const money = (value: number) => formatCurrency(value, currency);
  const datesIgnored = query.view === 'open' || query.view === 'review';

  return (
    <>
      <PageHeader
        title="Shift Management"
        description="Starting cash, cash taken and how each drawer counted out. Open shifts update on their own."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AutoRefresh renderedAt={new Date().toISOString()} />
            <PlanGate feature="reportExports" label="Export">
              <ShiftExportMenu />
            </PlanGate>
          </div>
        }
      />

      <section aria-label="Today's shift figures" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Active shifts" value={String(kpis.activeShifts)} icon={PlayCircle} href="/shifts?view=open" hint="Open right now" />
        <KpiCard label="Starting cash total" value={money(kpis.startingCashTotal)} icon={Wallet} hint="Floats of open shifts" />
        <KpiCard label="Cash sales today" value={money(kpis.cashSalesToday)} icon={Banknote} tone="success" hint="Cash only, after change" />
        <KpiCard label="Expected drawer cash" value={money(kpis.expectedDrawerCash)} icon={Vault} hint="Across open shifts" />
        <KpiCard label="Shifts closed today" value={String(kpis.closedToday)} icon={CircleCheck} />
        <KpiCard
          label="Cash discrepancies"
          value={String(kpis.pendingReview)}
          icon={TriangleAlert}
          tone={kpis.pendingReview > 0 ? 'warning' : 'default'}
          href="/shifts?view=review"
          hint={kpis.pendingReview > 0 ? 'Waiting for your review' : 'Nothing to review'}
        />
      </section>

      <div className="no-print mb-4 rounded-card border bg-card p-3 shadow-card [&>div]:mb-0">
        <FilterBar
          searchPlaceholder="Cashier or shift no. (SH-…)"
          selects={[
            {
              name: 'view',
              label: 'Status',
              allLabel: 'All shifts',
              width: 'w-[170px]',
              options: [
                { value: 'open', label: 'Open' },
                { value: 'closed', label: 'Closed' },
                { value: 'review', label: 'Requires review' },
              ],
            },
            {
              name: 'cashier',
              label: 'Cashier',
              allLabel: 'All cashiers',
              width: 'w-[180px]',
              options: cashiers.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: 'discrepancy',
              label: 'Discrepancy',
              allLabel: 'Any count',
              width: 'w-[170px]',
              options: [
                { value: 'any', label: 'Short or over' },
                { value: 'shortage', label: 'Shortages' },
                { value: 'overage', label: 'Overages' },
              ],
            },
            {
              name: 'sort',
              label: 'Sort',
              allLabel: 'Newest first',
              width: 'w-[190px]',
              options: [
                { value: 'opened_asc', label: 'Oldest first' },
                { value: 'closed_desc', label: 'Recently closed' },
                { value: 'variance', label: 'Largest shortage first' },
              ],
            },
          ]}
        >
          <PeriodPicker current={period} allowCustom customFrom={custom?.from} customTo={custom?.to} />
        </FilterBar>
        {datesIgnored && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing every {query.view === 'open' ? 'open shift' : 'shift waiting for review'}, whatever the dates.
          </p>
        )}
      </div>

      {result.refundsOutsideShift.count > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-text">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {money(result.refundsOutsideShift.amount)} in cash refunds ({result.refundsOutsideShift.count}) were paid {inlineLabel(range)} while
          no shift was open, so no drawer accounts for them.
        </p>
      )}

      <div className="overflow-hidden rounded-card border bg-card shadow-card">
        {result.shifts.length === 0 ? (
          <EmptyState
            icon={Coins}
            title="No shifts match"
            description={
              cashiers.length === 0
                ? 'Shifts appear here once a cashier opens one at the POS.'
                : 'Try another period or clear the filters.'
            }
            action={
              cashiers.length > 0 ? (
                <Link href="/shifts" className="text-sm font-medium text-primary hover:underline">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <ShiftMonitorTable shifts={result.shifts} currency={currency} />
            <div className="no-print">
              <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
