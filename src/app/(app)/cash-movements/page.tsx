import type { Metadata } from 'next';
import { ArrowDownToLine, ArrowUpFromLine, Scale, Wallet } from 'lucide-react';
import type { CashMovementCategory, CashMovementType } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { storeDb } from '@/lib/tenant/context';
import { CATEGORY_LABEL, TYPE_LABEL, type MovementCategory } from '@/lib/cash-movements';
import { formatCurrency, formatNumber } from '@/lib/format';
import { shiftReference } from '@/lib/shift-review';
import { getCurrency } from '@/server/services/settings-service';
import { inlineLabel, resolveRangeFromParams } from '@/server/analytics/date-range';
import { listCashMovements, listMovementCashiers } from '@/server/services/cash-movement-queries';
import { KpiCard } from '@/components/kpi-card';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { EmptyState } from '@/components/empty-state';
import { CashMovementTable } from '@/features/cash-movements/movement-table';

export const metadata: Metadata = { title: 'Cash In / Out' };
export const dynamic = 'force-dynamic';

const TYPES: CashMovementType[] = ['CASH_OUT', 'CASH_IN'];
const CATEGORIES = Object.keys(CATEGORY_LABEL) as MovementCategory[];

/**
 * Every cash in and cash out, from the same rows the drawer maths uses.
 * A cashier sees only their own; the owner sees every cashier's, with a
 * cashier filter. Sales, refunds and voids are separate and never listed here.
 */
export default async function CashMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    category?: string;
    cashier?: string;
    shift?: string;
    period?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('pos.view');
  const params = await searchParams;
  const isOwner = userCan(user, FINANCIAL_PERMISSION);
  // Taken from the session, never from the URL, for anyone but the owner.
  const ownOnly = isOwner ? null : user.id;

  // Opening one shift's movements shows all of them, whatever the period.
  const { period, range, custom } = resolveRangeFromParams(params, params.shift ? 'all' : 'today');
  const currency = await getCurrency();

  const shift = params.shift
    ? await (await storeDb()).cashierShift.findFirst({
        where: { id: params.shift, ...(ownOnly ? { userId: ownOnly } : {}) },
        select: { id: true, number: true },
      })
    : null;

  const [result, cashiers] = await Promise.all([
    listCashMovements({
      userId: ownOnly ?? (params.cashier || undefined),
      shiftId: params.shift ? (shift?.id ?? '__none__') : undefined,
      type: TYPES.includes(params.type as CashMovementType) ? (params.type as CashMovementType) : undefined,
      category: CATEGORIES.includes(params.category as MovementCategory) ? (params.category as CashMovementCategory) : undefined,
      search: params.q,
      from: range.from,
      to: range.to,
      page: Number(params.page) || 1,
    }),
    isOwner ? listMovementCashiers() : [],
  ]);
  const label = shift ? `on shift ${shiftReference(shift.number)}` : inlineLabel(range);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title sm:text-title-lg">Cash In / Out</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? 'Cash every cashier put into or took out of a drawer, with who, when, why and the shift.'
              : 'Cash you put into or took out of your drawer. Sales and refunds are not listed here.'}
          </p>
        </div>
        <PeriodPicker current={period} allowCustom customFrom={custom?.from} customTo={custom?.to} />
      </div>

      <section aria-label="Cash in and out summary" className="mb-4 grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Cash out"
          value={formatCurrency(result.summary.cashOut, currency)}
          icon={ArrowUpFromLine}
          tone="warning"
          hint={`${formatNumber(result.summary.cashOutCount, 0)} entr${result.summary.cashOutCount === 1 ? 'y' : 'ies'} ${label}`}
        />
        <KpiCard
          label="Cash in"
          value={formatCurrency(result.summary.cashIn, currency)}
          icon={ArrowDownToLine}
          hint={`${formatNumber(result.summary.cashInCount, 0)} entr${result.summary.cashInCount === 1 ? 'y' : 'ies'} ${label}`}
        />
        <KpiCard
          label="Effect on drawers"
          value={`${result.summary.net >= 0 ? '+' : '−'}${formatCurrency(Math.abs(result.summary.net), currency)}`}
          icon={Scale}
          hint="Cash in less cash out, corrections included"
        />
      </section>

      <div className="mb-4 rounded-card border bg-card p-3 shadow-card [&>div]:mb-0">
        <FilterBar
          searchPlaceholder="Search CO-000123, SH-000123 or a reason…"
          selects={[
            ...(isOwner
              ? [
                  {
                    name: 'cashier',
                    label: 'Cashier',
                    allLabel: 'All cashiers',
                    width: 'w-[170px]',
                    options: cashiers.map((cashier) => ({ value: cashier.id, label: cashier.name })),
                  },
                ]
              : []),
            {
              name: 'type',
              label: 'Type',
              allLabel: 'In and out',
              width: 'w-[140px]',
              options: TYPES.map((type) => ({ value: type, label: TYPE_LABEL[type] })),
            },
            {
              name: 'category',
              label: 'Category',
              allLabel: 'All categories',
              width: 'w-[190px]',
              options: CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABEL[category] })),
            },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-card border bg-card shadow-card">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={shift || params.q || params.type || params.category || params.cashier ? 'Nothing matches these filters' : `No cash in or out ${label}`}
            description="Cash in and cash out are recorded from the POS while a shift is open, with a category and a reason."
          />
        ) : (
          <>
            <CashMovementTable rows={result.rows} currency={currency} viewerId={user.id} isOwner={isOwner} />
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
