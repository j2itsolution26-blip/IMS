import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requirePermission } from '@/lib/session';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import {
  getSalesBreakdown,
  getSalesByHour,
  getSalesTimeSeries,
  getTopCustomers,
  granularityForRange,
  getPaymentMethodBreakdown,
  getMostReturnedProducts,
} from '@/server/analytics/sales-analytics';
import {
  getInventoryAging,
  getInventoryTurnover,
  getSupplierPerformance,
  getPurchaseTrends,
} from '@/server/analytics/inventory-analytics';
import { getComparedSalesSummary } from '@/server/analytics/dashboard';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDate, formatNumber, formatPercent, formatQuantity } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendChart } from '@/components/charts/trend-chart';
import { BreakdownChart, ColumnChart } from '@/components/charts/breakdown-chart';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePermission('analytics.view');
  const params = await searchParams;

  const period = parsePeriod(params.period, 'last30');
  const range = resolveRange(period);
  const currency = await getCurrency();

  const summary = await getComparedSalesSummary(range);

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Every figure is aggregated in the database from your recorded transactions for ${range.label.toLowerCase()}.`}
        actions={<PeriodPicker current={period} />}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue"
          value={formatCurrency(summary.current.revenue, currency)}
          change={summary.change.revenue}
          changeLabel="vs previous period"
        />
        <StatCard
          label="Gross profit"
          value={formatCurrency(summary.current.grossProfit, currency)}
          hint={`${summary.current.marginPercent.toFixed(1)}% margin`}
          tone={summary.current.grossProfit >= 0 ? 'success' : 'destructive'}
        />
        <StatCard
          label="Net profit"
          value={formatCurrency(summary.current.netProfit, currency)}
          change={summary.change.netProfit}
          changeLabel="vs previous period"
          hint={`after ${formatCurrency(summary.current.expenses, currency)} expenses`}
          tone={summary.current.netProfit >= 0 ? 'success' : 'destructive'}
        />
        <StatCard
          label="Returns"
          value={formatCurrency(summary.current.returnsTotal, currency)}
          hint={`${summary.current.returnsCount} return${summary.current.returnsCount === 1 ? '' : 's'}`}
          tone={summary.current.returnsTotal > 0 ? 'warning' : 'default'}
          invertChange
        />
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue and profit over time</CardTitle>
          <CardDescription>Bucketed automatically for the length of the period.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <TrendSection from={range.from} to={range.to} currency={currency} />
          </Suspense>
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-[380px] rounded-lg" />}>
          <BreakdownSection
            title="Sales by category"
            description="Which parts of the catalogue earn."
            dimension="category"
            from={range.from}
            to={range.to}
            currency={currency}
            colorIndex={0}
          />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-[380px] rounded-lg" />}>
          <BreakdownSection
            title="Sales by brand"
            description="Revenue grouped by manufacturer."
            dimension="brand"
            from={range.from}
            to={range.to}
            currency={currency}
            colorIndex={1}
          />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-[380px] rounded-lg" />}>
          <BreakdownSection
            title="Sales by supplier"
            description="Whose stock generates your revenue."
            dimension="supplier"
            from={range.from}
            to={range.to}
            currency={currency}
            colorIndex={2}
          />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-[380px] rounded-lg" />}>
          <BreakdownSection
            title="Sales by employee"
            description="Takings per person on the till."
            dimension="employee"
            from={range.from}
            to={range.to}
            currency={currency}
            colorIndex={3}
          />
        </Suspense>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trading pattern by hour</CardTitle>
            <CardDescription>When your customers actually buy, across the whole period.</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
              <HourlySection from={range.from} to={range.to} currency={currency} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Inventory ageing</CardTitle>
            <CardDescription>Stock value by how long it has been sitting since last receipt.</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
              <AgingSection currency={currency} />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <Suspense fallback={<Skeleton className="mb-4 h-[220px] rounded-lg" />}>
        <TurnoverSection from={range.from} to={range.to} currency={currency} />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-[340px] rounded-lg" />}>
          <CustomerSection from={range.from} to={range.to} currency={currency} />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-[340px] rounded-lg" />}>
          <SupplierSection from={range.from} to={range.to} currency={currency} />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-[340px] rounded-lg" />}>
          <PaymentSection from={range.from} to={range.to} currency={currency} />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-[340px] rounded-lg" />}>
          <ReturnsSection from={range.from} to={range.to} currency={currency} />
        </Suspense>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */

async function TrendSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const points = await getSalesTimeSeries(from, to, granularityForRange(from, to));
  return <TrendChart data={points} currency={currency} height={300} />;
}

async function BreakdownSection({
  title,
  description,
  dimension,
  from,
  to,
  currency,
  colorIndex,
}: {
  title: string;
  description: string;
  dimension: 'category' | 'brand' | 'supplier' | 'employee';
  from: Date;
  to: Date;
  currency: string;
  colorIndex: number;
}) {
  const rows = await getSalesBreakdown(dimension, from, to, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <BreakdownChart
          data={rows.map((row) => ({
            label: row.label,
            value: row.revenue,
            secondary: row.units,
            share: row.share,
          }))}
          currency={currency}
          valueLabel="Revenue"
          secondaryLabel="Units"
          colorIndex={colorIndex}
          height={240}
        />

        {/* The table view is the relief the palette requires for low-contrast
            series, and it carries the numbers the chart only approximates. */}
        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[10rem] truncate font-medium">{row.label}</TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(row.revenue, currency)}</TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(row.profit, currency)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {row.share.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function HourlySection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const rows = await getSalesByHour(from, to);
  return (
    <ColumnChart
      data={rows.map((row) => ({ label: row.label, value: row.revenue, secondary: row.orders }))}
      currency={currency}
      valueLabel="Revenue"
      secondaryLabel="Orders"
      colorIndex={0}
      height={260}
    />
  );
}

async function AgingSection({ currency }: { currency: string }) {
  const buckets = await getInventoryAging();
  return (
    <ColumnChart
      data={buckets.map((bucket) => ({ label: bucket.label, value: bucket.value, secondary: bucket.products }))}
      currency={currency}
      valueLabel="Stock value"
      secondaryLabel="Products"
      colorIndex={1}
      height={260}
    />
  );
}

async function TurnoverSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const [turnover, purchaseTrend] = await Promise.all([
    getInventoryTurnover(from, to),
    getPurchaseTrends(from, to, 'month'),
  ]);

  const totalSpend = purchaseTrend.reduce((acc, point) => acc + point.spend, 0);

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Inventory turnover"
        value={turnover.turnoverRatio > 0 ? `${turnover.turnoverRatio.toFixed(2)}×` : '—'}
        hint="COGS ÷ average stock value"
      />
      <StatCard
        label="Days on hand"
        value={turnover.daysOnHand != null ? `${turnover.daysOnHand} days` : '—'}
        hint="How long average stock sits before selling"
      />
      <StatCard
        label="Average stock value"
        value={formatCurrency(turnover.averageInventoryValue, currency)}
        hint="Opening and closing, averaged"
      />
      <StatCard
        label="Purchase spend"
        value={formatCurrency(totalSpend, currency)}
        hint={`${purchaseTrend.reduce((acc, p) => acc + p.orders, 0)} orders raised`}
      />
    </div>
  );
}

async function CustomerSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const customers = await getTopCustomers(from, to, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Best customers</CardTitle>
        <CardDescription>Ranked by spend in this period.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {customers.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            No sales were assigned to a named customer in this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Avg order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <p className="font-medium">{customer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      last bought {formatDate(customer.lastPurchase)}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right">{customer.orders}</TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatCurrency(customer.revenue, currency)}
                  </TableCell>
                  <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">
                    {formatCurrency(customer.averageOrderValue, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function SupplierSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const suppliers = await getSupplierPerformance(from, to, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Supplier performance</CardTitle>
        <CardDescription>Spend, reliability, and what is still owed.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {suppliers.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            No purchase orders were raised in this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">On time</TableHead>
                <TableHead className="text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.supplierId}>
                  <TableCell>
                    <p className="font-medium">{supplier.name}</p>
                    {supplier.averageLeadTimeDays != null && (
                      <p className="text-xs text-muted-foreground">
                        {supplier.averageLeadTimeDays} day average lead time
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {supplier.receivedOrders}/{supplier.orders}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`tabular ${
                        supplier.onTimeRate >= 90
                          ? 'text-success'
                          : supplier.onTimeRate >= 70
                            ? 'text-warning'
                            : 'text-destructive'
                      }`}
                    >
                      {supplier.receivedOrders > 0 ? formatPercent(supplier.onTimeRate, 0) : '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="tabular font-medium">{formatCurrency(supplier.totalSpend, currency)}</span>
                    {supplier.outstandingBalance > 0 && (
                      <span className="tabular block text-xs text-warning">
                        {formatCurrency(supplier.outstandingBalance, currency)} owed
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function PaymentSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const methods = await getPaymentMethodBreakdown(from, to);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Takings by payment method</CardTitle>
        <CardDescription>How your customers actually paid.</CardDescription>
      </CardHeader>
      <CardContent>
        {methods.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No incoming payments were recorded in this period.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {methods.map((method) => (
              <li key={method.method}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium capitalize">{method.method.toLowerCase().replace('_', ' ')}</span>
                  <span className="tabular">{formatCurrency(method.amount, currency)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${method.share}%` }} />
                  </div>
                  <span className="tabular w-20 text-right text-xs text-muted-foreground">
                    {method.share.toFixed(1)}% · {method.count}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function ReturnsSection({ from, to, currency }: { from: Date; to: Date; currency: string }) {
  const returns = await getMostReturnedProducts(from, to, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Most returned products</CardTitle>
        <CardDescription>A high rate usually points at quality or a misleading description.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {returns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nothing was returned in this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Refunded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map((item) => (
                <TableRow key={item.productId}>
                  <TableCell>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatQuantity(item.unitsReturned)}
                    <span className="block text-xs text-muted-foreground">
                      of {formatNumber(item.unitsSold, 0)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`tabular ${item.returnRate >= 10 ? 'text-destructive' : ''}`}>
                      {item.returnRate.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatCurrency(item.refundValue, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
