import type { Metadata } from 'next';
import { Lock, TriangleAlert, Wallet } from 'lucide-react';
import { requireUser, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { resolveRangeFromParams, inlineLabel } from '@/server/analytics/date-range';
import { listShifts } from '@/server/services/shift-service';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { EmptyState } from '@/components/empty-state';
import { ShiftHistoryTable } from '@/features/shifts/shift-history-table';

export const metadata: Metadata = { title: 'Shift history' };
export const dynamic = 'force-dynamic';

/**
 * Every cashier shift with its drawer reconciliation — the owner's view.
 *
 * Gated on the owner's financial permission (the same one that guards profit
 * and store-wide takings), checked here on the server; cashiers never reach
 * this page or its data. Records are read-only except that the owner may
 * close a shift a cashier left open.
 */
export default async function ShiftHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ cashier?: string; period?: string; from?: string; to?: string; page?: string }>;
}) {
  const user = await requireUser();
  // Refused before any shift data is read, with a plain message rather than
  // an error page.
  if (!userCan(user, FINANCIAL_PERMISSION)) {
    return (
      <EmptyState
        icon={Lock}
        title="Shift history is for the store owner"
        description="It shows every cashier's drawer counts. Your own shift is on your dashboard and at the POS."
      />
    );
  }
  const params = await searchParams;
  const { period, range, custom } = resolveRangeFromParams(params, 'week');

  const [cashiers, currency] = await Promise.all([
    prisma.user.findMany({
      where: { shifts: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    getCurrency(),
  ]);
  const cashierId = cashiers.some((c) => c.id === params.cashier) ? params.cashier : undefined;

  const result = await listShifts({ userId: cashierId, from: range.from, to: range.to, page: Number(params.page) || 1 });

  return (
    <>
      <PageHeader
        title="Shift history"
        description="Starting cash, cash taken, and how each drawer counted out. Open shifts are always listed."
        breadcrumbs={[{ label: 'Sales', href: '/sales' }, { label: 'Shift history' }]}
        actions={<PeriodPicker current={period} allowCustom customFrom={custom?.from} customTo={custom?.to} />}
      />

      <div className="mb-4 rounded-xl border bg-card p-3 shadow-2xs [&>div]:mb-0">
        <FilterBar
          showSearch={false}
          selects={[
            {
              name: 'cashier',
              label: 'Cashier',
              allLabel: 'All cashiers',
              width: 'w-[200px]',
              options: cashiers.map((c) => ({ value: c.id, label: c.name })),
            },
          ]}
        />
      </div>

      {result.refundsOutsideShift.count > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {formatCurrency(result.refundsOutsideShift.amount, currency)} in cash refunds ({result.refundsOutsideShift.count}) were paid{' '}
          {inlineLabel(range)} while no shift was open, so no drawer accounts for them.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-2xs">
        {result.shifts.length === 0 ? (
          <EmptyState icon={Wallet} title="No shifts in this period" description="Shifts appear here once a cashier opens one at the POS." />
        ) : (
          <>
            <ShiftHistoryTable
              currency={currency}
              shifts={result.shifts.map((s) => ({
                ...s,
                openedAt: s.openedAt.toISOString(),
                closedAt: s.closedAt?.toISOString() ?? null,
                movements: s.movements.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
              }))}
            />
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
