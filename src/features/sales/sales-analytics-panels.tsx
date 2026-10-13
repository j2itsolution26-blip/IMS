import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Clock, LineChart, PieChart, Trophy } from 'lucide-react';
import type { SalesOverview } from '@/server/analytics/sales-overview';
import { ColumnChart } from '@/components/charts/column-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { Panel, PanelEmpty } from '@/components/panel';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber, formatQuantity, formatSignedPercent, humanizeEnum } from '@/lib/format';
import { cn } from '@/lib/utils';

function ViewAll({ href, children = 'View all' }: { href: string; children?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary hover:underline"
    >
      {children} <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

const OpenPos = (
  <Button asChild size="sm">
    <Link href="/pos">Open POS</Link>
  </Button>
);

/* -------------------------------------------------------------------------- */

export function SalesPerformancePanel({
  trend,
  granularity,
  currency,
  rangeLabel,
  className,
}: {
  trend: SalesOverview['trend'];
  granularity: SalesOverview['granularity'];
  currency: string;
  rangeLabel: string;
  className?: string;
}) {
  const hasSales = trend.some((point) => point.revenue > 0 || point.orders > 0);
  const grain =
    granularity === 'hour' ? 'by hour' : granularity === 'month' ? 'by month' : granularity === 'week' ? 'by week' : 'by day';

  return (
    <Panel
      title="Sales performance"
      description={`Revenue, profit and transactions — ${rangeLabel.toLowerCase()}, ${grain}.`}
      className={className}
    >
      {!hasSales ? (
        <PanelEmpty
          icon={LineChart}
          title="No sales yet"
          description="Complete your first sale to start seeing revenue and profit trends."
          action={OpenPos}
        />
      ) : (
        <div className="p-4">
          <TrendChart
            currency={currency}
            height={260}
            data={trend.map((point) => ({
              label: point.label,
              revenue: point.revenue,
              profit: point.profit,
              orders: point.orders,
            }))}
          />
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function PaymentMethodsPanel({
  payments,
  currency,
  className,
}: {
  payments: SalesOverview['payments'];
  currency: string;
  className?: string;
}) {
  return (
    <Panel title="Payment methods" description="How customers paid." className={className}>
      {payments.length === 0 ? (
        <PanelEmpty
          icon={PieChart}
          title="No payment data"
          description="Payment analytics will appear after the first completed transaction."
        />
      ) : (
        <div className="p-4">
          <div className="mx-auto w-full max-w-[200px]">
            <DonutChart
              data={payments.map((row) => ({
                label: humanizeEnum(row.method),
                value: row.amount,
                count: row.count,
                share: row.share,
              }))}
              currency={currency}
              centerLabel="Total taken"
              emptyMessage="No payments in this period."
            />
          </div>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="pb-1.5 font-medium">Method</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Amount</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Share</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Txns</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((row, index) => (
                <tr key={row.method}>
                  <td className="py-1.5">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `var(--chart-${(index % 6) + 1})` }}
                      />
                      <span className="truncate font-medium">{humanizeEnum(row.method)}</span>
                    </span>
                  </td>
                  <td className="tabular py-1.5 text-right font-semibold">
                    {formatCurrency(row.amount, currency)}
                  </td>
                  <td className="tabular py-1.5 text-right text-muted-foreground">
                    {formatNumber(row.share, 1)}%
                  </td>
                  <td className="tabular py-1.5 text-right text-muted-foreground">
                    {formatNumber(row.count, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function DailySalesPanel({
  daily,
  currency,
  className,
}: {
  daily: SalesOverview['daily'];
  currency: string;
  className?: string;
}) {
  const rows = daily.filter((day) => day.orders > 0).slice(0, 6);

  return (
    <Panel
      title="Daily sales"
      description="Daily summary for this month."
      action={<ViewAll href="/reports/sales-summary" />}
      className={className}
    >
      {rows.length === 0 ? (
        <PanelEmpty
          icon={BarChart3}
          title="No sales this month"
          description="Days with completed sales will be listed here."
          action={OpenPos}
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">Date</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Txns</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Items</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Revenue</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((day) => (
                <tr key={day.bucket}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                    <Link
                      href={`/sales?period=custom&from=${day.bucket.slice(0, 10)}&to=${day.bucket.slice(0, 10)}`}
                      className="hover:underline"
                    >
                      {day.label}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">{formatNumber(day.orders, 0)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{formatQuantity(day.units)}</td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">
                    {formatCurrency(day.revenue, currency)}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-muted-foreground">
                    {formatCurrency(day.profit, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function MonthlySalesPanel({
  monthly,
  currency,
  className,
}: {
  monthly: SalesOverview['monthly'];
  currency: string;
  className?: string;
}) {
  return (
    <Panel
      title="Monthly sales"
      description="Revenue and profit over the last six months."
      className={className}
    >
      <div className="p-4">
        <ColumnChart
          data={monthly.map((month) => ({
            label: month.label,
            value: month.revenue,
            secondary: month.profit,
          }))}
          currency={currency}
          valueLabel="Revenue"
          secondaryLabel="Profit"
          height={210}
          emptyMessage="Months with completed sales will appear here."
        />
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function ComparisonRow({
  label,
  value,
  change,
  previous,
}: {
  label: string;
  value: string;
  change: number | null;
  previous: string;
}) {
  const isFlat = change != null && Math.abs(change) < 0.05;
  const isUp = change != null && change > 0;
  const TrendIcon = isFlat ? ArrowRight : isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2.5">
        <span className="tabular text-sm font-semibold">{value}</span>
        {change != null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
              isFlat
                ? 'bg-muted text-muted-foreground'
                : isUp
                  ? 'bg-success/10 text-success'
                  : 'bg-destructive/10 text-destructive',
            )}
          >
            <TrendIcon className="h-3 w-3" aria-hidden="true" />
            {formatSignedPercent(change)}
          </span>
        )}
        <span className="tabular text-xs text-muted-foreground">{previous}</span>
      </span>
    </div>
  );
}

export function SalesComparisonPanel({
  comparison,
  labels,
  currency,
  className,
}: {
  comparison: SalesOverview['monthComparison'];
  labels: SalesOverview['monthLabels'];
  currency: string;
  className?: string;
}) {
  const { current, previous, change } = comparison;
  const against = (value: string) => `vs ${labels.previous} ${value}`;

  return (
    <Panel
      title="Sales comparison"
      description={`${labels.current} against ${labels.previous}.`}
      className={className}
    >
      <div className="divide-y">
        <ComparisonRow
          label="Revenue"
          value={formatCurrency(current.revenue, currency)}
          change={change.revenue}
          previous={against(formatCurrency(previous.revenue, currency))}
        />
        <ComparisonRow
          label="Profit"
          value={formatCurrency(current.netProfit, currency)}
          change={change.netProfit}
          previous={against(formatCurrency(previous.netProfit, currency))}
        />
        <ComparisonRow
          label="Transactions"
          value={formatNumber(current.transactionCount, 0)}
          change={change.transactionCount}
          previous={against(formatNumber(previous.transactionCount, 0))}
        />
        <ComparisonRow
          label="Items sold"
          value={formatNumber(current.itemsSold, 0)}
          change={change.itemsSold}
          previous={against(formatNumber(previous.itemsSold, 0))}
        />
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function TopProductsPanel({
  products,
  currency,
  className,
}: {
  products: SalesOverview['topProducts'];
  currency: string;
  className?: string;
}) {
  return (
    <Panel
      title="Top selling products"
      description="Ranked by quantity sold."
      action={<ViewAll href="/reports/best-selling" />}
      className={className}
    >
      {products.length === 0 ? (
        <PanelEmpty
          icon={Trophy}
          title="No sales data"
          description="Product performance will appear after completed transactions."
          action={OpenPos}
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">#</th>
                <th scope="col" className="px-4 py-2 font-medium">Product</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Qty</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Revenue</th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">Profit</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((product, index) => (
                <tr key={product.productId}>
                  <td className="tabular px-4 py-2.5 text-muted-foreground">{index + 1}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <ProductImage
                        src={product.imageUrl}
                        alt={product.name}
                        size="sm"
                        fit="cover"
                        className="h-8 w-8 shrink-0 rounded-md"
                      />
                      <Link
                        href={`/products/${product.productId}`}
                        className="min-w-0 max-w-[12rem] truncate font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                    </span>
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">{formatQuantity(product.unitsSold)}</td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">
                    {formatCurrency(product.revenue, currency)}
                  </td>
                  <td className="tabular hidden px-4 py-2.5 text-right text-muted-foreground sm:table-cell">
                    {formatCurrency(product.profit, currency)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={cn(
                        'tabular inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                        product.currentStock <= 0
                          ? 'bg-destructive/10 text-destructive'
                          : product.currentStock < 10
                            ? 'bg-warning/15 text-warning'
                            : 'bg-success/10 text-success',
                      )}
                    >
                      {formatQuantity(product.currentStock)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function CategorySalesPanel({
  categories,
  currency,
  className,
}: {
  categories: SalesOverview['categories'];
  currency: string;
  className?: string;
}) {
  return (
    <Panel title="Sales by category" description="Where the revenue came from." className={className}>
      {categories.length === 0 ? (
        <PanelEmpty
          icon={PieChart}
          title="No category data"
          description="Category analytics will appear after completed transactions."
        />
      ) : (
        <div className="p-4">
          <div className="mx-auto w-full max-w-[200px]">
            <DonutChart
              data={categories.map((row) => ({ label: row.label, value: row.revenue, share: row.share }))}
              currency={currency}
              centerLabel="Total sales"
              emptyMessage="No category sales in this period."
            />
          </div>

          <ul className="mt-4 space-y-2">
            {categories.map((row, index) => (
              <li key={row.id} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--chart-${(index % 6) + 1})` }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                <span className="tabular font-semibold">{formatCurrency(row.revenue, currency)}</span>
                <span className="tabular w-12 text-right text-xs text-muted-foreground">
                  {formatNumber(row.share, 1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function HourlySalesPanel({
  hourly,
  currency,
  rangeLabel,
  className,
}: {
  hourly: SalesOverview['hourly'];
  currency: string;
  rangeLabel: string;
  className?: string;
}) {
  // Trading hours only — a 24-bar chart of mostly zeroes hides the shape.
  const trading = hourly.filter((point) => point.hour >= 5 && point.hour <= 22);
  const quiet = trading.every((point) => point.revenue === 0);

  return (
    <Panel
      title="Sales by hour"
      description={`When the shop was busy — ${rangeLabel.toLowerCase()}.`}
      className={className}
    >
      {quiet ? (
        <PanelEmpty
          icon={Clock}
          title="No sales in this period"
          description="Hourly trading patterns appear once sales are recorded."
          action={OpenPos}
        />
      ) : (
        <div className="p-4">
          <ColumnChart
            data={trading.map((point) => ({ label: point.label, value: point.revenue }))}
            currency={currency}
            valueLabel="Revenue"
            height={210}
            emptyMessage="No sales recorded in trading hours."
          />
        </div>
      )}
    </Panel>
  );
}
