import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Boxes, LineChart, PieChart, ShoppingCart } from 'lucide-react';
import type { DashboardOverview } from '@/server/analytics/dashboard-overview';
import type { StockStatus } from '@/server/analytics/inventory-analytics';
import type { Granularity } from '@/server/analytics/sales-analytics';
import { BreakdownChart } from '@/components/charts/breakdown-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { ProductImage } from '@/components/product-image';
import { ViewSaleButton } from '@/features/dashboard/view-sale-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelEmpty } from '@/components/panel';
import { formatCurrency, formatDateTime, formatNumber, formatQuantity, humanizeEnum } from '@/lib/format';
import { SALE_STATUS_BADGE, SALE_STATUS_LABEL } from '@/lib/sale-status';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Shared chrome                                                              */
/* -------------------------------------------------------------------------- */

function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary hover:underline"
    >
      {children} <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

/**
 * A small segmented control made of links, so the choice lives in the URL
 * and the server re-queries — the same model as the period picker.
 */
function SegmentLinks({
  label,
  options,
}: {
  label: string;
  options: { label: string; href: string; active: boolean }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border bg-muted/40 p-0.5">
      {options.map((option) => (
        <Link
          key={option.label}
          href={option.href}
          scroll={false}
          aria-current={option.active ? 'true' : undefined}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            option.active ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sales overview                                                             */
/* -------------------------------------------------------------------------- */

const BUCKET_NOUN: Record<Granularity, { title: string; per: string }> = {
  hour: { title: 'Hour', per: 'by hour' },
  day: { title: 'Day', per: 'by day' },
  week: { title: 'Week', per: 'by week' },
  month: { title: 'Month', per: 'by month' },
  year: { title: 'Year', per: 'by year' },
};

export function SalesOverviewPanel({
  trend,
  granularity,
  rangeLabel,
  currency,
  className,
}: {
  trend: DashboardOverview['trend'];
  granularity: Granularity;
  rangeLabel: string;
  currency: string;
  className?: string;
}) {
  const hasSales = trend.some((point) => point.revenue > 0 || point.orders > 0);
  const noun = BUCKET_NOUN[granularity];

  return (
    <Panel
      title="Sales Overview"
      description={`Revenue ${noun.per} — ${rangeLabel}. Hover a point for its figures.`}
      className={className}
    >
      {!hasSales ? (
        <PanelEmpty
          icon={LineChart}
          title="No sales in this period"
          description="Completed sales are charted here as soon as they are rung up."
        />
      ) : (
        <div className="p-4">
          <TrendChart
            currency={currency}
            height={280}
            showProfit={false}
            periodLabel={noun.title}
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
/* Sales by category                                                          */
/* -------------------------------------------------------------------------- */

/** Bars beyond this fold into "Other" — a ranked chart stops being read past it. */
const CATEGORY_BARS = 6;

export function CategorySalesPanel({
  categories,
  currency,
  className,
}: {
  categories: DashboardOverview['categories'];
  currency: string;
  className?: string;
}) {
  const shown = categories.slice(0, CATEGORY_BARS);
  const rest = categories.slice(CATEGORY_BARS);
  const bars = shown.map((row) => ({ label: row.label, value: row.revenue, share: row.share }));
  if (rest.length > 0) {
    bars.push({
      label: `Other (${rest.length})`,
      value: rest.reduce((acc, row) => acc + row.revenue, 0),
      share: Number(rest.reduce((acc, row) => acc + row.share, 0).toFixed(2)),
    });
  }

  return (
    <Panel
      title="Sales by Category"
      description="Item sales after line discounts, as a share of the period."
      className={className}
    >
      {categories.length === 0 ? (
        <PanelEmpty
          icon={PieChart}
          title="No category sales"
          description="Each category's share appears once products in it are sold."
        />
      ) : (
        <div className="p-4">
          <BreakdownChart data={bars} currency={currency} height={bars.length * 34 + 28} />

          <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto scrollbar-thin border-t pt-3">
            {categories.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-sm">
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
/* Top selling products                                                       */
/* -------------------------------------------------------------------------- */

export function TopProductsPanel({
  products,
  currency,
  showProfit,
  limitOptions,
  className,
}: {
  products: DashboardOverview['topProducts'];
  currency: string;
  /** Only when the viewer may see profit and every sold line carries a cost. */
  showProfit: boolean;
  limitOptions: { label: string; href: string; active: boolean }[];
  className?: string;
}) {
  return (
    <Panel
      title="Top-Selling Products"
      description="Ranked by revenue over the selected period."
      action={<MoreLink href="/reports/best-selling">Report</MoreLink>}
      className={className}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <SegmentLinks label="Number of products" options={limitOptions} />
      </div>

      {products.length === 0 ? (
        <PanelEmpty
          icon={Boxes}
          title="No products sold"
          description="Best sellers for this period will be ranked here."
        />
      ) : (
        <ol className="divide-y">
          {products.map((product, index) => (
            <li key={product.productId} className="flex items-center gap-3 px-4 py-2.5">
              <span className="tabular w-5 shrink-0 text-sm font-semibold text-muted-foreground">{index + 1}</span>
              <ProductImage
                src={product.imageUrl}
                alt={product.name}
                size="sm"
                fit="cover"
                className="h-9 w-9 shrink-0 rounded-lg"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${product.productId}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {product.name}
                </Link>
                <p className="tabular text-xs text-muted-foreground">
                  {formatQuantity(product.unitsSold)} pcs sold
                  {showProfit && <> · {formatCurrency(product.profit, currency)} profit</>}
                </p>
              </div>
              <span className="tabular shrink-0 text-sm font-semibold">
                {formatCurrency(product.revenue, currency)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Low stock                                                                  */
/* -------------------------------------------------------------------------- */

const STOCK_BADGE: Partial<Record<StockStatus, { label: string; variant: 'destructive' | 'warning' }>> = {
  OUT_OF_STOCK: { label: 'Out of stock', variant: 'destructive' },
  CRITICAL: { label: 'Critical', variant: 'destructive' },
  LOW: { label: 'Low', variant: 'warning' },
};

export function LowStockPanel({
  rows,
  total,
  className,
}: {
  rows: DashboardOverview['lowStock'];
  total: number;
  className?: string;
}) {
  return (
    <Panel
      title="Low-Stock Alerts"
      description={
        total > rows.length
          ? `Showing ${rows.length} of ${formatNumber(total, 0)} products at or below their low-stock level.`
          : 'Products at or below their low-stock level. Quantities are pieces on hand.'
      }
      action={<MoreLink href="/inventory?status=LOW_ANY">View all</MoreLink>}
      className={className}
    >
      {rows.length === 0 ? (
        <PanelEmpty
          icon={Boxes}
          title="No low-stock items"
          description="Every product is above its low-stock level."
        />
      ) : (
        <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-3">
          {rows.map((row) => {
            const badge = STOCK_BADGE[row.status] ?? STOCK_BADGE.LOW!;
            const threshold = row.reorderLevel > 0 ? row.reorderLevel : row.minStock;
            return (
              <li key={row.productId} className="sm:border-b">
                <Link
                  href={`/products/${row.productId}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                >
                  <ProductImage
                    src={row.imageUrl}
                    alt={row.name}
                    size="sm"
                    fit="cover"
                    className="h-9 w-9 shrink-0 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {formatQuantity(row.available)} pcs on hand · low at{' '}
                      {formatQuantity(threshold)}
                    </p>
                  </div>
                  <Badge variant={badge.variant} className="shrink-0">
                    {badge.label}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Recent transactions                                                        */
/* -------------------------------------------------------------------------- */

const HEAD = 'whitespace-nowrap px-4 py-2 font-medium';
const CELL = 'whitespace-nowrap px-4 py-2.5';

export function RecentTransactionsPanel({
  sales,
  currency,
  viewAllHref,
  className,
}: {
  sales: DashboardOverview['recentSales'];
  currency: string;
  viewAllHref: string;
  className?: string;
}) {
  return (
    <Panel
      title="Recent Sales"
      description="Latest sales in this period. Voided sales are left out."
      action={<MoreLink href={viewAllHref}>View All Sales</MoreLink>}
      className={className}
    >
      {sales.length === 0 ? (
        <PanelEmpty
          icon={ShoppingCart}
          title="No sales in this period"
          description="Completed sales will appear here with their receipt."
          action={
            <Button asChild size="sm">
              <Link href="/pos">Open POS</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={HEAD}>Receipt</th>
                <th scope="col" className={HEAD}>Date &amp; time</th>
                <th scope="col" className={cn(HEAD, 'text-right')}>Items</th>
                <th scope="col" className={cn(HEAD, 'text-right')}>Subtotal</th>
                <th scope="col" className={cn(HEAD, 'text-right')}>Discount</th>
                <th scope="col" className={cn(HEAD, 'text-right')}>Total</th>
                <th scope="col" className={HEAD}>Payment</th>
                <th scope="col" className={HEAD}>Status</th>
                <th scope="col" className={cn(HEAD, 'text-right')}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className={CELL}>
                    <Link href={`/sales/${sale.id}`} className="font-medium hover:underline">
                      {sale.invoiceNumber}
                    </Link>
                  </td>
                  <td className={cn(CELL, 'text-xs text-muted-foreground')}>{formatDateTime(sale.createdAt)}</td>
                  <td className={cn(CELL, 'tabular text-right')}>{formatNumber(sale.itemCount, 0)}</td>
                  <td className={cn(CELL, 'tabular text-right')}>{formatCurrency(sale.grossAmount, currency)}</td>
                  <td className={cn(CELL, 'tabular text-right text-muted-foreground')}>
                    {sale.discountAmount > 0 ? `−${formatCurrency(sale.discountAmount, currency)}` : '—'}
                  </td>
                  <td className={cn(CELL, 'tabular text-right font-semibold')}>
                    {formatCurrency(sale.total, currency)}
                  </td>
                  <td className={cn(CELL, 'text-xs text-muted-foreground')}>
                    {sale.paymentMethod === 'GCASH'
                      ? 'GCash'
                      : sale.paymentMethod
                        ? humanizeEnum(sale.paymentMethod)
                        : '—'}
                  </td>
                  <td className={CELL}>
                    <Badge variant={SALE_STATUS_BADGE[sale.status]}>{SALE_STATUS_LABEL[sale.status]}</Badge>
                  </td>
                  <td className={cn(CELL, 'text-right')}>
                    <ViewSaleButton saleId={sale.id} />
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
