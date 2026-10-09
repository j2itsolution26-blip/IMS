import Link from 'next/link';
import { Banknote, PackageCheck, Receipt, ShoppingCart, TrendingUp, TriangleAlert } from 'lucide-react';
import type { DateRange, PeriodKey } from '@/server/analytics/date-range';
import type { DashboardOverview } from '@/server/analytics/dashboard-overview';
import { inlineLabel } from '@/server/analytics/date-range';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { PeriodPicker } from '@/components/period-picker';
import { KpiCard } from '@/features/dashboard/kpi-card';
import { SalesPerformancePanel } from '@/features/dashboard/sales-performance-panel';
import {
  LowStockPanel,
  PaymentBreakdownPanel,
  QuickActionsPanel,
  RecentTransactionsPanel,
  SlowMovingPanel,
  TopProductsPanel,
} from '@/features/dashboard/overview-panels';

export interface DashboardPermissions {
  sell: boolean;
  createProduct: boolean;
  adjustStock: boolean;
}

/**
 * The dashboard composition.
 *
 * Separated from the route so the page owns only authentication and the one
 * data pass, and this can be rendered against any window.
 */
export function DashboardView({
  firstName,
  period,
  range,
  custom,
  currency,
  data,
  can,
}: {
  firstName: string;
  period: PeriodKey;
  range: DateRange;
  custom: { from: string; to: string } | null;
  currency: string;
  data: DashboardOverview;
  can: DashboardPermissions;
}) {
  const { current, change } = data.summary;
  const lowStockCount = data.snapshot.lowStock + data.snapshot.criticalStock;
  const comparison = `vs ${range.isCustom ? 'previous period' : `previous ${inlineLabel(range)}`}`;

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&rsquo;s what&rsquo;s happening in your store — {inlineLabel(range)}.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker current={period} allowCustom customFrom={custom?.from} customTo={custom?.to} />
          {can.sell && (
            <Button asChild size="lg" className="h-11 rounded-xl">
              <Link href="/pos">
                <ShoppingCart /> New sale
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <section aria-label="Business summary" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          label="Sales"
          value={formatCurrency(current.revenue, currency)}
          icon={Receipt}
          change={change.revenue}
          changeLabel={comparison}
          series={data.trend.map((point) => point.revenue)}
          href="/sales"
        />
        <KpiCard
          label="Transactions"
          value={formatNumber(current.transactionCount, 0)}
          icon={ShoppingCart}
          change={change.transactionCount}
          changeLabel={comparison}
          series={data.trend.map((point) => point.orders)}
          href="/sales"
        />
        <KpiCard
          label="Items sold"
          value={formatNumber(current.itemsSold, 0)}
          icon={PackageCheck}
          change={change.itemsSold}
          changeLabel={comparison}
          series={data.trend.map((point) => point.units)}
          href="/reports/best-selling"
        />
        <KpiCard
          label="Gross profit"
          value={formatCurrency(current.netProfit, currency)}
          icon={TrendingUp}
          tone={current.netProfit < 0 ? 'destructive' : 'success'}
          change={change.netProfit}
          changeLabel={comparison}
          series={data.trend.map((point) => point.profit)}
          href="/reports/profit"
        />
        <KpiCard
          label="Low stock"
          value={formatNumber(lowStockCount, 0)}
          icon={TriangleAlert}
          tone={lowStockCount > 0 ? 'warning' : 'default'}
          hint={
            data.snapshot.outOfStock > 0
              ? `${formatNumber(data.snapshot.outOfStock, 0)} out of stock`
              : `${formatNumber(data.activeProducts, 0)} products stocked`
          }
          href="/inventory?status=LOW"
        />
        <KpiCard
          label="Cash sales"
          value={formatCurrency(current.cashSales, currency)}
          icon={Banknote}
          hint="Cash taken in this period"
          href="/reports/sales-by-payment-method"
        />
      </section>

      {/* Analytics */}
      <div className="mb-4 grid items-start gap-4 xl:grid-cols-5">
        <SalesPerformancePanel
          trend={data.trend}
          summary={current}
          currency={currency}
          // The centrepiece, but not the whole row.
          className="xl:col-span-3"
        />
        <PaymentBreakdownPanel payments={data.payments} currency={currency} className="xl:col-span-2" />
      </div>

      {/* Products and stock */}
      <div className="mb-4 grid items-start gap-4 xl:grid-cols-2">
        <TopProductsPanel products={data.topProducts} currency={currency} />
        <LowStockPanel rows={data.lowStock} canRestock={can.adjustStock} />
      </div>

      {/* Transactions, slow movers and actions */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <RecentTransactionsPanel sales={data.recentSales} currency={currency} className="xl:col-span-2" />
        <div className="grid gap-4">
          <SlowMovingPanel rows={data.slowMoving} currency={currency} />
          <QuickActionsPanel
            canCreateProduct={can.createProduct}
            canAdjustStock={can.adjustStock}
          />
        </div>
      </div>
    </>
  );
}
