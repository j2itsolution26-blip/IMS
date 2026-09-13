import type { Metadata } from 'next';
import Link from 'next/link';
import { format as formatDatePart } from 'date-fns';
import { Package, Receipt, ShoppingBag, TrendingUp } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { REPORTS } from '@/server/reports/registry';
import { resolveReportWindow } from '@/server/reports/report-window';
import { getInventorySnapshot, getProductPerformance, getSalesSummary } from '@/server/analytics/dashboard';
import { getPaymentMethodBreakdown, getSalesTimeSeries, granularityForRange } from '@/server/analytics/sales-analytics';
import { getStockLevels, type StockLevelRow } from '@/server/analytics/inventory-analytics';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatNumber, formatPercent, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { ProductImage } from '@/components/product-image';
import { ColumnChart } from '@/components/charts/breakdown-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExportMenu } from '@/features/reports/export-menu';
import { MoreReportsMenu } from '@/features/reports/more-reports-menu';
import { ReportsPeriodPicker } from '@/features/reports/reports-period-picker';

export const metadata: Metadata = { title: 'Reports' };

// Every figure is read live, so a sale or a stock change shows up on the next
// load rather than being served from a cache.
export const dynamic = 'force-dynamic';

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  CARD: 'Card',
  OTHER: 'Other',
};

const asDateInput = (date: Date) => formatDatePart(date, 'yyyy-MM-dd');

/**
 * Everything at or below its low-stock level, plus everything already out.
 * Queried per status because the stock register filters on one status at a
 * time; out-of-stock leads because it is the most urgent to act on.
 */
async function getRunningOut(limit: number): Promise<StockLevelRow[]> {
  const [out, critical, low] = await Promise.all([
    getStockLevels({ status: 'OUT_OF_STOCK', page: 1, pageSize: limit }),
    getStockLevels({ status: 'CRITICAL', page: 1, pageSize: limit }),
    getStockLevels({ status: 'LOW', page: 1, pageSize: limit }),
  ]);
  return [...out.rows, ...critical.rows, ...low.rows].slice(0, limit);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission('reports.view');
  const query = await searchParams;

  const range = resolveReportWindow(query, 'today');
  const canSeeStock = userCan(user, 'inventory.view');

  const currency = await getCurrency();

  const [summary, points, bestSellers, payments, snapshot, runningOut] = await Promise.all([
    getSalesSummary(range.from, range.to),
    getSalesTimeSeries(range.from, range.to, granularityForRange(range.from, range.to)),
    getProductPerformance({
      from: range.from,
      to: range.to,
      sort: 'units',
      direction: 'desc',
      limit: 5,
    }),
    getPaymentMethodBreakdown(range.from, range.to),
    canSeeStock ? getInventorySnapshot() : null,
    canSeeStock ? getRunningOut(5) : [],
  ]);

  // Each product falls into exactly one of these buckets, so the four figures
  // add up to the catalogue.
  const lowStockCount = snapshot ? snapshot.lowStock + snapshot.criticalStock : 0;
  const inStockCount = snapshot ? snapshot.healthyStock + snapshot.overStock : 0;

  const paymentTotal = payments.reduce((acc, row) => acc + row.amount, 0);

  // Only reports this role can actually open.
  const available = REPORTS.filter((report) => userCan(user, report.permission));

  return (
    <>
      <PageHeader
        title="Reports"
        description="See how your store is doing."
        actions={
          <>
            <ReportsPeriodPicker
              period={range.period}
              from={asDateInput(range.from)}
              to={asDateInput(range.to)}
              label={range.label}
            />
            {userCan(user, 'reports.export') && (
              <ExportMenu
                reportId="sales-summary"
                period={range.period}
                from={range.preset ? undefined : asDateInput(range.from)}
                to={range.preset ? undefined : asDateInput(range.to)}
              />
            )}
          </>
        }
      />

      <section aria-labelledby="totals-heading" className="mb-6">
        <h2 id="totals-heading" className="sr-only">
          Headline figures
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Sales"
            value={formatCurrency(summary.revenue, currency)}
            icon={Receipt}
            hint={range.label}
          />
          <StatCard
            label="Transactions"
            value={formatNumber(summary.transactionCount, 0)}
            icon={ShoppingBag}
            href="/sales"
          />
          <StatCard label="Items sold" value={formatQuantity(summary.itemsSold)} icon={Package} />
          <StatCard
            label="Profit"
            value={formatCurrency(summary.netProfit, currency)}
            icon={TrendingUp}
            tone={summary.netProfit > 0 ? 'success' : summary.netProfit < 0 ? 'destructive' : 'default'}
            hint={summary.revenue > 0 ? `${formatPercent(summary.marginPercent)} margin` : undefined}
          />
        </div>
      </section>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sales</CardTitle>
          <CardDescription>{range.label}</CardDescription>
        </CardHeader>
        <CardContent>
          <ColumnChart
            data={points.map((point) => ({
              label: point.label,
              value: point.revenue,
              secondary: point.orders,
            }))}
            currency={currency}
            valueLabel="Sales"
            secondaryLabel="Transactions"
            height={260}
          />

          <dl className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
            <Figure label="Total sales" value={formatCurrency(summary.revenue, currency)} />
            <Figure label="Average sale" value={formatCurrency(summary.averageOrderValue, currency)} />
            <Figure label="Transactions" value={formatNumber(summary.transactionCount, 0)} />
            <Figure label="Items sold" value={formatQuantity(summary.itemsSold)} />
          </dl>
        </CardContent>
      </Card>

      {/* Stock sections are hidden from roles without inventory access, so the
          grid only splits in two when there is a second card to show. */}
      <div className={cn('mb-6 grid gap-4', snapshot && 'lg:grid-cols-2')}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Best-selling products</CardTitle>
            <CardDescription>Most units sold in this period.</CardDescription>
          </CardHeader>
          <CardContent>
            {bestSellers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No products were sold in this period yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {bestSellers.map((product, index) => (
                  <li key={product.productId} className="flex items-center gap-3">
                    <span className="tabular w-4 shrink-0 text-sm font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <ProductImage src={product.imageUrl} alt={product.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${product.productId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatCurrency(product.revenue, currency)}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm font-semibold">
                      {formatQuantity(product.unitsSold)} sold
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <Button variant="outline" className="mt-4 w-full" asChild>
              <Link
                href={
                  range.preset ? `/reports/best-selling?period=${range.preset}` : '/reports/best-selling'
                }
              >
                View All
              </Link>
            </Button>
          </CardContent>
        </Card>

        {snapshot && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Inventory</CardTitle>
              <CardDescription>Your stock right now.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                <StockRow label="Total products" value={snapshot.distinctProducts} href="/inventory" />
                <StockRow label="In stock" value={inStockCount} dot="🟢" href="/inventory" />
                <StockRow label="Low stock" value={lowStockCount} dot="🟡" href="/inventory?status=LOW" />
                <StockRow
                  label="Out of stock"
                  value={snapshot.outOfStock}
                  dot="🔴"
                  href="/inventory?status=OUT_OF_STOCK"
                />
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <div className={cn('mb-6 grid gap-4', snapshot && 'lg:grid-cols-2')}>
        {snapshot && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Low stock</CardTitle>
              <CardDescription>Running out — restock these soon.</CardDescription>
            </CardHeader>
            <CardContent>
              {runningOut.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Everything is well stocked right now.
                </p>
              ) : (
                <ul className="space-y-3">
                  {runningOut.map((row) => {
                    const isOut = row.status === 'OUT_OF_STOCK';
                    return (
                      <li key={row.productId} className="flex items-center gap-3">
                        <ProductImage src={row.imageUrl} alt={row.name} size="sm" />
                        <Link
                          href={`/products/${row.productId}`}
                          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span
                          className={`tabular shrink-0 text-sm font-medium ${
                            isOut ? 'text-destructive' : 'text-warning'
                          }`}
                        >
                          {formatQuantity(row.onHand)} {row.unitAbbreviation}
                        </span>
                        <span className="shrink-0 text-sm" aria-hidden="true">
                          {isOut ? '🔴' : '🟡'}
                        </span>
                        <span className="sr-only">{isOut ? 'Out of stock' : 'Low stock'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <Button variant="outline" className="mt-4 w-full" asChild>
                <Link href="/inventory">View Inventory</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payment methods</CardTitle>
            <CardDescription>How you were paid in this period.</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No payments were recorded in this period yet.
              </p>
            ) : (
              <ul className="space-y-3.5">
                {payments.map((payment) => (
                  <li key={payment.method}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">
                        {PAYMENT_LABEL[payment.method] ?? payment.method}
                      </span>
                      <span className="tabular text-sm font-semibold">
                        {formatCurrency(payment.amount, currency)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                      {/* A tiny share still gets a visible sliver, but nothing
                          is drawn for a method that took no money. */}
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: payment.amount > 0 ? `${Math.max(payment.share, 2)}%` : 0 }}
                      />
                    </div>
                  </li>
                ))}
                <li className="flex items-baseline justify-between gap-3 border-t pt-3">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="tabular text-sm font-semibold">
                    {formatCurrency(paymentTotal, currency)}
                  </span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="border-t pt-5">
        <MoreReportsMenu
          reports={available.map((report) => ({
            id: report.id,
            name: report.name,
            group: report.group,
            usesDateRange: report.usesDateRange,
          }))}
          period={range.preset ?? undefined}
        />
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function StockRow({
  label,
  value,
  dot,
  href,
}: {
  label: string;
  value: number;
  dot?: string;
  href: string;
}) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
        <span className="flex items-center gap-2 text-sm">
          {dot && (
            <span className="text-xs" aria-hidden="true">
              {dot}
            </span>
          )}
          {label}
        </span>
        <span className="tabular text-lg font-semibold">{formatNumber(value, 0)}</span>
      </Link>
    </li>
  );
}
