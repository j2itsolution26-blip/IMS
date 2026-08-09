import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { Boxes, Coins, PackageX, Receipt, ShoppingBag, TrendingUp } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { formatCompactCurrency, formatCurrency, formatNumber, formatQuantity } from '@/lib/format';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import {
  getComparedSalesSummary,
  getInventorySnapshot,
  getProductPerformance,
  getRecentInventoryActivity,
  getRecentPurchases,
  getRecentSales,
  getReorderSuggestions,
  getSupplierAlerts,
} from '@/server/analytics/dashboard';
import { getSalesTimeSeries, granularityForRange } from '@/server/analytics/sales-analytics';
import { generateInsights } from '@/server/analytics/insights';
import { getSettings, readString } from '@/server/services/settings-service';
import { detectSupplierDelays } from '@/server/services/purchase-service';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { PeriodPicker } from '@/components/period-picker';
import { TrendChart } from '@/components/charts/trend-chart';
import { InsightPanel } from '@/features/dashboard/insight-panel';
import { StockHealthCard } from '@/features/dashboard/stock-health-card';
import { ReorderCard } from '@/features/dashboard/reorder-card';
import { ActivityFeeds } from '@/features/dashboard/activity-feeds';
import { ProductLeaderboard } from '@/features/dashboard/product-leaderboard';

export const metadata: Metadata = { title: 'Dashboard' };

// Every figure is live; caching would show the owner yesterday's numbers.
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requirePermission('dashboard.view');
  const { period: periodParam } = await searchParams;
  const period = parsePeriod(periodParam, 'today');
  const range = resolveRange(period);

  const settings = await getSettings();
  const currency = readString(settings, 'locale.currency') || 'PHP';

  // Refresh late-delivery alerts on load rather than depending on a scheduler.
  void detectSupplierDelays().catch(() => undefined);

  const [summary, snapshot] = await Promise.all([
    getComparedSalesSummary(range),
    getInventorySnapshot(),
  ]);

  const { current, change } = summary;
  const comparisonLabel = period === 'today' ? 'vs yesterday' : 'vs previous period';

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        description={`Live figures for ${range.label.toLowerCase()}. Everything below is calculated from your recorded transactions.`}
        actions={
          <>
            <PeriodPicker current={period} />
            {userCan(user, 'pos.create') && (
              <Button asChild>
                <Link href="/pos">Open POS</Link>
              </Button>
            )}
          </>
        }
      />

      {/* Trading performance */}
      <section aria-labelledby="trading-heading" className="mb-6">
        <h2 id="trading-heading" className="sr-only">
          Trading performance
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Revenue"
            value={formatCurrency(current.revenue, currency)}
            icon={Coins}
            change={change.revenue}
            changeLabel={comparisonLabel}
            href="/reports/sales-summary"
          />
          <StatCard
            label="Net profit"
            value={formatCurrency(current.netProfit, currency)}
            icon={TrendingUp}
            tone={current.netProfit >= 0 ? 'success' : 'destructive'}
            change={change.netProfit}
            changeLabel={comparisonLabel}
            hint={`${current.marginPercent.toFixed(1)}% gross margin`}
            href="/reports/profit"
          />
          <StatCard
            label="Transactions"
            value={formatNumber(current.transactionCount, 0)}
            icon={Receipt}
            change={change.transactionCount}
            changeLabel={comparisonLabel}
            hint={
              current.transactionCount > 0
                ? `${formatCurrency(current.averageOrderValue, currency)} average`
                : undefined
            }
            href="/sales"
          />
          <StatCard
            label="Products sold"
            value={formatQuantity(current.itemsSold)}
            icon={ShoppingBag}
            change={change.itemsSold}
            changeLabel={comparisonLabel}
            href="/reports/sales-summary"
          />
        </div>
      </section>

      {/* Stock position */}
      <section aria-labelledby="stock-heading" className="mb-6">
        <h2 id="stock-heading" className="sr-only">
          Stock position
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Inventory value"
            value={formatCurrency(snapshot.costValue, currency)}
            icon={Boxes}
            hint={`${formatCompactCurrency(snapshot.retailValue, currency)} at retail`}
            href="/inventory"
          />
          <StatCard
            label="Available stock"
            value={formatQuantity(snapshot.available)}
            icon={Boxes}
            hint={
              snapshot.reserved > 0
                ? `${formatQuantity(snapshot.reserved)} reserved`
                : `${snapshot.stockedProducts} products in stock`
            }
            href="/inventory"
          />
          <StatCard
            label="Needs reordering"
            value={formatNumber(snapshot.lowStock + snapshot.criticalStock, 0)}
            icon={PackageX}
            tone={snapshot.criticalStock > 0 ? 'warning' : 'default'}
            hint={snapshot.criticalStock > 0 ? `${snapshot.criticalStock} critical` : 'At or below reorder level'}
            href="/inventory?status=LOW"
          />
          <StatCard
            label="Out of stock"
            value={formatNumber(snapshot.outOfStock, 0)}
            icon={PackageX}
            tone={snapshot.outOfStock > 0 ? 'destructive' : 'success'}
            hint={snapshot.deadStock > 0 ? `${snapshot.deadStock} dead stock lines` : 'Nothing unavailable'}
            href="/inventory?status=OUT_OF_STOCK"
          />
        </div>
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue and profit</CardTitle>
            <CardDescription>{range.label}, from completed sales.</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <TrendSection from={range.from} to={range.to} currency={currency} />
            </Suspense>
          </CardContent>
        </Card>

        <Suspense fallback={<Skeleton className="h-[380px] w-full rounded-lg" />}>
          <InsightSection />
        </Suspense>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <StockHealthCard snapshot={snapshot} currency={currency} />

        <Suspense fallback={<Skeleton className="h-[340px] w-full rounded-lg lg:col-span-2" />}>
          <ReorderSection currency={currency} canPurchase={userCan(user, 'purchases.create')} />
        </Suspense>
      </div>

      <Suspense fallback={<Skeleton className="mb-6 h-[380px] w-full rounded-lg" />}>
        <LeaderboardSection from={range.from} to={range.to} currency={currency} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}>
        <ActivitySection currency={currency} />
      </Suspense>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Streamed sections. Each fetches independently so a slow aggregate never
 * blocks the KPI tiles from painting.
 * ---------------------------------------------------------------------- */

async function TrendSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const points = await getSalesTimeSeries(from, to, granularityForRange(from, to));
  return (
    <TrendChart
      currency={currency}
      data={points.map((p) => ({
        label: p.label,
        revenue: p.revenue,
        profit: p.profit,
        orders: p.orders,
      }))}
    />
  );
}

async function InsightSection() {
  const insights = await generateInsights(6);
  return <InsightPanel insights={insights} />;
}

async function ReorderSection({ currency, canPurchase }: { currency: string; canPurchase: boolean }) {
  const [suggestions, supplierAlerts] = await Promise.all([
    getReorderSuggestions(6),
    getSupplierAlerts(4),
  ]);
  return (
    <ReorderCard
      suggestions={suggestions}
      supplierAlerts={supplierAlerts}
      currency={currency}
      canPurchase={canPurchase}
    />
  );
}

async function LeaderboardSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const [best, worst, mostProfitable] = await Promise.all([
    getProductPerformance({ from, to, sort: 'units', direction: 'desc', limit: 5 }),
    getProductPerformance({ from, to, sort: 'units', direction: 'asc', limit: 5, includeUnsold: true }),
    getProductPerformance({ from, to, sort: 'profit', direction: 'desc', limit: 5 }),
  ]);

  return (
    <div className="mb-6">
      <ProductLeaderboard best={best} worst={worst} mostProfitable={mostProfitable} currency={currency} />
    </div>
  );
}

async function ActivitySection({ currency }: { currency: string }) {
  const [sales, purchases, movements] = await Promise.all([
    getRecentSales(6),
    getRecentPurchases(6),
    getRecentInventoryActivity(8),
  ]);

  return <ActivityFeeds sales={sales} purchases={purchases} movements={movements} currency={currency} />;
}

