import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { Banknote, Boxes, PackageX, Receipt, ShoppingBag } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatCurrency, formatNumber } from '@/lib/format';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { getInventorySnapshot, getSalesSummary } from '@/server/analytics/dashboard';
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

  const [summary, snapshot, totalProducts] = await Promise.all([
    getSalesSummary(range.from, range.to),
    getInventorySnapshot(),
    prisma.product.count({ where: { status: 'ACTIVE' } }),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        description={`Live figures for ${range.label.toLowerCase()}.`}
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

      <section aria-labelledby="today-heading" className="mb-6">
        <h2 id="today-heading" className="sr-only">
          Today
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
            hint={
              summary.transactionCount > 0
                ? `${formatCurrency(summary.averageOrderValue, currency)} average`
                : undefined
            }
            href="/sales"
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
