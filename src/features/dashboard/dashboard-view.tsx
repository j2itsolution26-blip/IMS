import type { ReactNode } from 'react';
import {
  CalendarDays,
  CalendarRange,
  Coins,
  Lock,
  Receipt,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  Vault,
  Wallet,
} from 'lucide-react';
import type { DateRange, PeriodKey } from '@/server/analytics/date-range';
import type { DashboardOverview } from '@/server/analytics/dashboard-overview';
import type { ShiftKpis } from '@/server/services/shift-service';
import { inlineLabel } from '@/server/analytics/date-range';
import { formatCurrency, formatNumber } from '@/lib/format';
import { STORE_TIME_ZONE } from '@/lib/store-time';
import { PeriodPicker } from '@/components/period-picker';
import { KpiBars, KpiCard } from '@/components/kpi-card';
import { RefreshButton } from '@/features/dashboard/refresh-button';
import {
  CategorySalesPanel,
  LowStockPanel,
  RecentTransactionsPanel,
  SalesOverviewPanel,
  TopProductsPanel,
} from '@/features/dashboard/overview-panels';

/** The presets this screen offers; everything else is a custom range. */
export const DASHBOARD_PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

const COMPARISON_LABEL: Partial<Record<PeriodKey, string>> = {
  today: 'vs yesterday',
  yesterday: 'vs the day before',
  week: 'vs last week',
  month: 'vs last month',
  year: 'vs last year',
};

/** The dashboard's own URL state, used to build links that keep it. */
export interface DashboardQuery {
  period: PeriodKey;
  from?: string;
  to?: string;
  top: 5 | 10;
}

function hrefWith(base: string, query: Partial<DashboardQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

/**
 * The Sales Dashboard.
 *
 * The first card row is pinned to today, this week and this month so the
 * owner's daily glance never depends on the filter; everything below it
 * follows the selected period.
 */
export function DashboardView({
  storeName,
  query,
  range,
  rangeNotice,
  currency,
  generatedAt,
  data,
  drawers,
  tabs,
}: {
  /** The owner's Sales / Inventory switch, rendered above the header. */
  tabs?: ReactNode;
  storeName: string;
  query: DashboardQuery;
  range: DateRange;
  /** Shown when the requested custom range could not be used. */
  rangeNotice: string | null;
  currency: string;
  generatedAt: string;
  data: DashboardOverview;
  /** Today's cash drawers across every cashier; null when the role may not see them. */
  drawers: ShiftKpis | null;
}) {
  const { headline, summary, canViewProfit } = data;
  const { current, change } = summary;
  const periodLabel = inlineLabel(range);
  const comparison = COMPARISON_LABEL[query.period] ?? 'vs previous period';
  const costIncomplete = current.zeroCostLines > 0;

  const today = new Date(generatedAt).toLocaleDateString('en-PH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: STORE_TIME_ZONE,
  });

  const keep = { period: query.period, from: query.from, to: query.to };
  const self = (patch: Partial<DashboardQuery>) => hrefWith('/dashboard', { ...keep, top: query.top, ...patch });

  return (
    <>
      {tabs}
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display">Sales Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{storeName}</span> · {today}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker
            current={query.period}
            options={DASHBOARD_PERIODS}
            allowCustom
            customFrom={query.from}
            customTo={query.to}
          />
          <RefreshButton generatedAt={generatedAt} />
        </div>
      </div>

      {rangeNotice && (
        <p role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {rangeNotice}
        </p>
      )}

      {/* Fixed windows */}
      <section aria-label="Sales to date" className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Today's Sales"
          value={formatCurrency(headline.today.revenue, currency)}
          icon={Receipt}
          change={headline.today.change}
          changeLabel="vs yesterday"
          hint={transactions(headline.today.transactions)}
          footer={{ label: "See today's sales", href: '/sales?period=today' }}
          inverse
        />
        <KpiCard
          label="Weekly Sales"
          value={formatCurrency(headline.week.revenue, currency)}
          icon={CalendarDays}
          change={headline.week.change}
          changeLabel="vs last week"
          hint={`${transactions(headline.week.transactions)} · Mon–Sun`}
          footer={{ label: "See this week's sales", href: '/sales?period=week' }}
        />
        <KpiCard
          label="Monthly Revenue"
          value={formatCurrency(headline.month.revenue, currency)}
          icon={CalendarRange}
          change={headline.month.change}
          changeLabel="vs last month"
          hint={transactions(headline.month.transactions)}
          footer={{ label: "See this month's sales", href: '/sales?period=month' }}
        />
      </section>

      {/* Selected period */}
      <section aria-label={`Totals for ${periodLabel}`} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Net Sales"
          value={formatCurrency(current.netSales, currency)}
          icon={Coins}
          change={change.netSales}
          changeLabel={comparison}
          hint={
            current.discounts > 0 || current.returnsTotal > 0
              ? `${formatCurrency(current.grossSales, currency)} gross − ${formatCurrency(current.discounts, currency)} discounts − ${formatCurrency(current.returnsTotal, currency)} refunds`
              : capitalise(periodLabel)
          }
          footer={{ label: 'See sales', href: hrefWith('/sales', keep) }}
        />
        {canViewProfit ? (
          <KpiCard
            label={costIncomplete ? 'Estimated Profit (incomplete)' : 'Estimated Profit'}
            value={formatCurrency(current.netProfit, currency)}
            icon={costIncomplete ? TriangleAlert : TrendingUp}
            tone={costIncomplete ? 'warning' : current.netProfit < 0 ? 'destructive' : 'success'}
            change={costIncomplete ? null : change.netProfit}
            changeLabel={comparison}
            hint={
              costIncomplete
                ? `${formatNumber(current.zeroCostLines, 0)} sold ${current.zeroCostLines === 1 ? 'line has' : 'lines have'} no cost price, so profit is overstated`
                : `Net sales − ${formatCurrency(current.netCostOfGoods, currency)} cost of goods`
            }
            footer={{ label: 'See profit report', href: '/reports/profit' }}
          />
        ) : (
          <KpiCard
            label="Estimated Profit"
            value="Restricted"
            icon={Lock}
            hint="Profit and cost figures are visible to the owner only"
          />
        )}
        <KpiCard
          label="Total Transactions"
          value={formatNumber(current.transactionCount, 0)}
          icon={ShoppingCart}
          change={change.transactionCount}
          changeLabel={comparison}
          hint={`Avg ${formatCurrency(current.averageOrderValue, currency)} net per sale`}
          visual={<KpiBars data={data.trend.map((point) => point.orders)} />}
          footer={{ label: 'See transactions', href: hrefWith('/sales', keep) }}
        />
      </section>

      {/* Cash drawers — today's trading day, whatever period is selected. */}
      {drawers && (
        <section aria-label="Cash drawers today" className="mb-4 grid gap-3 sm:grid-cols-3">
          <KpiCard
            label="Open shifts"
            value={formatNumber(drawers.activeShifts, 0)}
            icon={Wallet}
            hint={
              drawers.activeShifts > 0
                ? `${formatCurrency(drawers.startingCashTotal, currency)} starting cash`
                : 'No drawer is open'
            }
            footer={{ label: 'See open shifts', href: '/shifts?view=open' }}
          />
          <KpiCard
            label="Expected drawer cash"
            value={formatCurrency(drawers.expectedDrawerCash, currency)}
            icon={Vault}
            hint="Across open shifts"
            footer={{ label: 'See drawers', href: '/shifts?view=open' }}
          />
          <KpiCard
            label="Cash to review"
            value={formatNumber(drawers.pendingReview, 0)}
            icon={TriangleAlert}
            tone={drawers.pendingReview > 0 ? 'warning' : 'default'}
            hint={drawers.pendingReview > 0 ? 'Waiting for your review' : 'Nothing to review'}
            footer={{ label: 'Review shifts', href: '/shifts?view=review' }}
          />
        </section>
      )}

      {/* Charts */}
      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <SalesOverviewPanel
          trend={data.trend}
          granularity={data.granularity}
          rangeLabel={periodLabel}
          currency={currency}
          now={generatedAt}
          className="xl:col-span-2"
        />
        <CategorySalesPanel categories={data.categories} currency={currency} />
      </div>

      {/* Products and sales */}
      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <TopProductsPanel
          products={data.topProducts}
          currency={currency}
          showProfit={canViewProfit && !costIncomplete}
          limitOptions={([5, 10] as const).map((top) => ({
            label: `Top ${top}`,
            href: self({ top }),
            active: query.top === top,
          }))}
        />
        <RecentTransactionsPanel
          sales={data.recentSales}
          currency={currency}
          viewAllHref={hrefWith('/sales', keep)}
          className="xl:col-span-2"
        />
      </div>

      <LowStockPanel rows={data.lowStock} total={data.lowStockTotal} />
    </>
  );
}

function transactions(count: number): string {
  return `${formatNumber(count, 0)} ${count === 1 ? 'transaction' : 'transactions'}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
