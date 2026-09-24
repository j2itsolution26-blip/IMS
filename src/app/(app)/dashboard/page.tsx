import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Package } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatCurrency, formatNumber, formatQuantity } from '@/lib/format';
import { inlineLabel, resolveRangeFromParams } from '@/server/analytics/date-range';
import { getInventorySnapshot, getProductPerformance, getSalesSummary } from '@/server/analytics/dashboard';
import { getStockLevels, type StockLevelRow } from '@/server/analytics/inventory-analytics';
import { getSalesTimeSeries, granularityForRange } from '@/server/analytics/sales-analytics';
import { getSettings, readString } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { ProductImage } from '@/components/product-image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { PeriodPicker } from '@/components/period-picker';
import { TrendChart } from '@/components/charts/trend-chart';
import { SalesHistory } from '@/features/dashboard/sales-history';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };

// Every figure is live; caching would show the owner yesterday's numbers.
export const dynamic = 'force-dynamic';

/**
 * Everything at or below its low-stock level, plus everything already out.
 * Queried per status because the stock register filters on one at a time;
 * out-of-stock leads because it is the most urgent to act on.
 */
async function getNeedsAttention(limit: number): Promise<StockLevelRow[]> {
  const [out, critical, low] = await Promise.all([
    getStockLevels({ status: 'OUT_OF_STOCK', page: 1, pageSize: limit }),
    getStockLevels({ status: 'CRITICAL', page: 1, pageSize: limit }),
    getStockLevels({ status: 'LOW', page: 1, pageSize: limit }),
  ]);
  return [...out.rows, ...critical.rows, ...low.rows].slice(0, limit);
}

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

  const [summary, snapshot, totalProducts, bestSellers, needsAttention] = await Promise.all([
    getSalesSummary(range.from, range.to),
    getInventorySnapshot(),
    prisma.product.count({ where: { status: 'ACTIVE' } }),
    getProductPerformance({ from: range.from, to: range.to, sort: 'units', limit: 5 }),
    getNeedsAttention(5),
  ]);

  const isToday = period === 'today';
  const lowStock = snapshot.lowStock + snapshot.criticalStock;
  const transactions = formatNumber(summary.transactionCount, 0);

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
              <Button asChild size="lg">
                <Link href="/pos">Open POS</Link>
              </Button>
            )}
          </>
        }
      />

      {/* The three numbers an owner opens this page for. Built here rather than
          with the shared StatCard so the emphasis can be larger than the
          compact stock tiles below without changing five other pages. */}
      <section aria-labelledby="money-heading" className="mb-4">
        <h2 id="money-heading" className="sr-only">
          Sales for {range.label}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Headline
            label={isToday ? "Today's sales" : 'Sales'}
            value={formatCurrency(summary.revenue, currency)}
            hint={`${transactions} transaction${summary.transactionCount === 1 ? '' : 's'}`}
            href="/sales"
          />
          <Headline label="Transactions" value={transactions} href="/sales" />
          <Headline
            label="Profit"
            value={formatCurrency(summary.netProfit, currency)}
            hint={summary.revenue > 0 ? `${formatNumber(summary.marginPercent, 1)}% margin` : undefined}
            tone={summary.netProfit < 0 ? 'destructive' : 'default'}
            href="/reports/profit"
          />
        </div>
      </section>

      <section aria-labelledby="stock-heading" className="mb-6">
        <h2 id="stock-heading" className="sr-only">
          Inventory
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Total products" value={formatNumber(totalProducts, 0)} href="/products" />
          {/* Calm at zero, coloured only when there is something to do. */}
          <Tile
            label="Low stock"
            value={formatNumber(lowStock, 0)}
            tone={lowStock > 0 ? 'warning' : 'default'}
            href="/inventory?status=LOW"
          />
          <Tile
            label="Out of stock"
            value={formatNumber(snapshot.outOfStock, 0)}
            tone={snapshot.outOfStock > 0 ? 'destructive' : 'default'}
            href="/inventory?status=OUT_OF_STOCK"
          />
        </div>
      </section>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{isToday ? "Today's sales" : 'Sales'}</CardTitle>
          <CardDescription>Revenue and profit for {inlineLabel(range)}.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
            <TrendSection from={range.from} to={range.to} currency={currency} />
          </Suspense>
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top selling products</CardTitle>
            <CardDescription>Most units sold {inlineLabel(range)}.</CardDescription>
          </CardHeader>
          <CardContent>
            {bestSellers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sales yet {inlineLabel(range)}.
              </p>
            ) : (
              <ul className="space-y-3">
                {bestSellers.map((product) => (
                  <li key={product.productId} className="flex items-center gap-3">
                    <ProductImage src={product.imageUrl} alt={product.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${product.productId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatNumber(product.unitsSold, 0)} sold
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm font-semibold">
                      {formatCurrency(product.revenue, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription>Products to restock.</CardDescription>
          </CardHeader>
          <CardContent>
            {needsAttention.length === 0 ? (
              // Nothing is wrong, so nothing shouts. An alert here every day
              // would teach the owner to ignore the one that matters.
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" />
                <p className="text-sm font-medium">Inventory looks good</p>
                <p className="text-xs text-muted-foreground">No products need restocking.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {needsAttention.map((row) => {
                  const isOut = row.status === 'OUT_OF_STOCK';
                  return (
                    <li key={row.productId} className="flex items-center gap-3">
                      <AlertTriangle
                        className={cn('h-4 w-4 shrink-0', isOut ? 'text-destructive' : 'text-warning')}
                        aria-hidden="true"
                      />
                      <Link
                        href={`/products/${row.productId}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span
                        className={cn(
                          'tabular shrink-0 text-sm font-medium',
                          isOut ? 'text-destructive' : 'text-warning',
                        )}
                      >
                        {isOut
                          ? 'Out of stock'
                          : `${formatQuantity(row.onHand)} ${row.unitAbbreviation} left`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Carried over from the stock-health card this section replaces:
                capital sitting on the shelf is still something to act on. */}
            {snapshot.deadStock > 0 && (
              <p className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                {snapshot.deadStock} product{snapshot.deadStock === 1 ? '' : 's'} holding stock with no recent
                sales.{' '}
                <Link href="/reports/dead-stock" className="font-medium underline">
                  Review dead stock
                </Link>
              </p>
            )}

            <Button variant="outline" className="mt-4 w-full" asChild>
              <Link href="/inventory">
                <Package /> View inventory
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

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

/** One of the three headline figures: the largest type on the page. */
function Headline({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'destructive';
  href: string;
}) {
  return (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full p-5 transition-colors hover:border-primary/40">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p
          className={cn(
            'tabular mt-2 text-2xl font-semibold tracking-tight sm:text-3xl',
            tone === 'destructive' && 'text-destructive',
          )}
        >
          {value}
        </p>
        <p className="mt-1 h-4 text-xs text-muted-foreground">{hint ?? ''}</p>
      </Card>
    </Link>
  );
}

/** A compact stock count. Deliberately smaller than a headline figure. */
function Tile({
  label,
  value,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'destructive';
  href: string;
}) {
  return (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card
        className={cn(
          'flex h-full items-center justify-between gap-3 px-4 py-3 transition-colors hover:border-primary/40',
          tone === 'warning' && 'border-warning/40 bg-warning/5',
          tone === 'destructive' && 'border-destructive/40 bg-destructive/5',
        )}
      >
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className={cn(
            'tabular text-lg font-semibold',
            tone === 'warning' && 'text-warning',
            tone === 'destructive' && 'text-destructive',
          )}
        >
          {value}
        </span>
      </Card>
    </Link>
  );
}

async function TrendSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const points = await getSalesTimeSeries(from, to, granularityForRange(from, to));
  return (
    <TrendChart
      currency={currency}
      // Shorter than the reporting default: this is a glance, and an empty
      // day should not leave a screen-deep hole above the rest of the page.
      height={240}
      data={points.map((p) => ({
        label: p.label,
        revenue: p.revenue,
        profit: p.profit,
        orders: p.orders,
      }))}
    />
  );
}
