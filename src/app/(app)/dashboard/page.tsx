import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { Banknote, Boxes, Calculator, PackageCheck, PackageX, Receipt, ShoppingBag, TrendingUp } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatCurrency, formatNumber } from '@/lib/format';
import { inlineLabel, resolveRangeFromParams } from '@/server/analytics/date-range';
import { getInventorySnapshot, getProductPerformance, getSalesSummary } from '@/server/analytics/dashboard';
import { getSalesTimeSeries, granularityForRange } from '@/server/analytics/sales-analytics';
import { getSettings, readString } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { PeriodPicker } from '@/components/period-picker';
import { TrendChart } from '@/components/charts/trend-chart';
import { StockHealthCard } from '@/features/dashboard/stock-health-card';
import { SalesHistory } from '@/features/dashboard/sales-history';

export const metadata: Metadata = { title: 'Dashboard' };

// Every figure is live; caching would show the owner yesterday's numbers.
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    q?: string;
    method?: string;
    cashier?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('dashboard.view');
  const params = await searchParams;
  const { period, range, custom } = resolveRangeFromParams(params, 'today');

  const settings = await getSettings();
  const currency = readString(settings, 'locale.currency') || 'PHP';

  const [summary, snapshot, totalProducts, bestSellers] = await Promise.all([
    getSalesSummary(range.from, range.to),
    getInventorySnapshot(),
    prisma.product.count({ where: { status: 'ACTIVE' } }),
    getProductPerformance({ from: range.from, to: range.to, sort: 'units', limit: 5 }),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        description={`Live figures for ${inlineLabel(range)}.`}
        actions={
          <>
            <PeriodPicker
              current={period}
              allowCustom
              customFrom={custom?.from}
              customTo={custom?.to}
            />
            {userCan(user, 'pos.create') && (
              <Button asChild>
                <Link href="/pos">Open POS</Link>
              </Button>
            )}
          </>
        }
      />

      <section aria-labelledby="sales-heading" className="mb-6">
        <h2 id="sales-heading" className="sr-only">
          Sales for {range.label}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Sales"
            value={formatCurrency(summary.revenue, currency)}
            icon={Receipt}
            hint={`${formatNumber(summary.transactionCount, 0)} transaction${summary.transactionCount === 1 ? '' : 's'}`}
            href="/sales"
          />
          <StatCard
            label="Transactions"
            value={formatNumber(summary.transactionCount, 0)}
            icon={ShoppingBag}
            href="/sales"
          />
          <StatCard
            label="Average sale"
            value={formatCurrency(summary.averageOrderValue, currency)}
            icon={Calculator}
            href="/sales"
          />
          <StatCard
            label="Items sold"
            value={formatNumber(summary.itemsSold, 0)}
            icon={PackageCheck}
            href="/reports/best-selling"
          />
          <StatCard
            label="Profit"
            value={formatCurrency(summary.netProfit, currency)}
            icon={TrendingUp}
            tone={summary.netProfit < 0 ? 'destructive' : 'default'}
            hint={summary.revenue > 0 ? `${formatNumber(summary.marginPercent, 1)}% margin` : undefined}
            href="/reports/profit"
          />
          <StatCard
            label="Cash sales"
            value={formatCurrency(summary.cashSales, currency)}
            icon={Banknote}
            href="/reports/sales-by-payment-method"
          />
        </div>
      </section>

      <section aria-labelledby="stock-heading" className="mb-6">
        <h2 id="stock-heading" className="sr-only">
          Stock position
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Total products" value={formatNumber(totalProducts, 0)} icon={Boxes} href="/products" />
          <StatCard
            label="Low stock"
            value={formatNumber(snapshot.lowStock + snapshot.criticalStock, 0)}
            icon={PackageX}
            tone={snapshot.criticalStock > 0 ? 'warning' : 'default'}
            href="/inventory?status=LOW"
          />
          <StatCard
            label="Out of stock"
            value={formatNumber(snapshot.outOfStock, 0)}
            icon={PackageX}
            tone={snapshot.outOfStock > 0 ? 'destructive' : 'success'}
            href="/inventory?status=OUT_OF_STOCK"
          />
        </div>
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily sales</CardTitle>
            <CardDescription>{range.label}, from completed sales.</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <TrendSection from={range.from} to={range.to} currency={currency} />
            </Suspense>
          </CardContent>
        </Card>

        <StockHealthCard snapshot={snapshot} currency={currency} />
      </div>

      <section aria-labelledby="best-selling-heading" className="mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle id="best-selling-heading" className="text-base">
              Best-selling products
            </CardTitle>
            <CardDescription>{range.label}, by quantity sold.</CardDescription>
          </CardHeader>
          <CardContent>
            {bestSellers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales recorded</p>
            ) : (
              <ul className="divide-y">
                {bestSellers.map((product) => (
                  <li key={product.productId} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                    <div className="min-w-0">
                      <Link href={`/products/${product.productId}`} className="truncate text-sm font-medium hover:underline">
                        {product.name}
                      </Link>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatNumber(product.unitsSold, 0)} sold
                      </p>
                    </div>
                    <span className="tabular whitespace-nowrap text-sm font-medium">
                      {formatCurrency(product.revenue, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <SalesHistory
        from={range.from}
        to={range.to}
        rangeLabel={range.label}
        currency={currency}
        search={params.q}
        paymentMethod={params.method}
        cashierId={params.cashier}
        page={params.page}
      />
    </>
  );
}

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
