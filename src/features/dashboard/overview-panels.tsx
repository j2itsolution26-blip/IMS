import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  FileText,
  PackagePlus,
  Plus,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DashboardOverview } from '@/server/analytics/dashboard-overview';
import { DonutChart } from '@/components/charts/donut-chart';
import { ProductImage } from '@/components/product-image';
import { ViewSaleButton } from '@/features/dashboard/view-sale-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatCurrency, formatDateTime, formatNumber, formatQuantity, humanizeEnum } from '@/lib/format';
import { SALE_STATUS_BADGE, SALE_STATUS_LABEL } from '@/lib/sale-status';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Shared chrome                                                              */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // min-w-0 matters: a grid and flex child defaults to min-width:auto, so
    // without it a wide table or chart pushes the whole page sideways on a
    // phone instead of scrolling inside its own panel.
    <Card className={cn('flex min-w-0 flex-col overflow-hidden rounded-xl', className)}>
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </Card>
  );
}

/** A panel with nothing in it still has to say something useful. */
export function PanelEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <Icon className="mb-1 h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

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

/* -------------------------------------------------------------------------- */
/* Payment methods                                                            */
/* -------------------------------------------------------------------------- */

export function PaymentBreakdownPanel({
  payments,
  currency,
  className,
}: {
  payments: DashboardOverview['payments'];
  currency: string;
  className?: string;
}) {
  return (
    <Panel title="Payment methods" description="How customers paid in this period." className={className}>
      {payments.length === 0 ? (
        <PanelEmpty
          icon={BarChart3}
          title="No payments yet"
          description="Once a sale is charged, the split across cash and GCash shows here."
        />
      ) : (
        <div className="p-4">
          <div className="mx-auto w-full max-w-[220px]">
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

          <ul className="mt-4 space-y-2.5">
            {payments.map((row, index) => (
              <li key={row.method} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--chart-${(index % 6) + 1})` }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{humanizeEnum(row.method)}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {formatNumber(row.count, 0)} {row.count === 1 ? 'payment' : 'payments'}
                </span>
                <span className="tabular w-20 text-right font-semibold">
                  {formatCurrency(row.amount, currency)}
                </span>
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
}: {
  products: DashboardOverview['topProducts'];
  currency: string;
}) {
  return (
    <Panel
      title="Top selling products"
      description="Most sold during the selected period."
      action={<MoreLink href="/reports/best-selling">View all</MoreLink>}
    >
      {products.length === 0 ? (
        <PanelEmpty
          icon={Boxes}
          title="No products sold yet"
          description="Complete a sale and your best sellers will be ranked here."
          action={
            <Button asChild size="sm">
              <Link href="/pos">Open POS</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y">
          {products.map((product, index) => (
            <li key={product.productId} className="flex items-center gap-3 px-4 py-3">
              <span className="tabular w-5 shrink-0 text-sm font-semibold text-muted-foreground">
                {index + 1}
              </span>
              <ProductImage
                src={product.imageUrl}
                alt={product.name}
                size="sm"
                fit="cover"
                className="h-10 w-10 shrink-0 rounded-lg"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${product.productId}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {product.name}
                </Link>
                <p className="tabular text-xs text-muted-foreground">
                  {formatQuantity(product.unitsSold)} sold · {formatQuantity(product.currentStock)} in stock
                </p>
              </div>
              <span className="tabular shrink-0 text-sm font-semibold">
                {formatCurrency(product.revenue, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Low stock                                                                  */
/* -------------------------------------------------------------------------- */

export function LowStockPanel({
  rows,
  canRestock,
}: {
  rows: DashboardOverview['lowStock'];
  canRestock: boolean;
}) {
  return (
    <Panel
      title="Low stock alerts"
      description="Shelves that need attention."
      action={<MoreLink href="/inventory?status=LOW">View all</MoreLink>}
    >
      {rows.length === 0 ? (
        <PanelEmpty
          icon={Boxes}
          title="No low-stock items"
          description="Every product is above its reorder level. Nothing to restock today."
        />
      ) : (
        <ul className="divide-y">
          {rows.map((row) => {
            const out = row.available <= 0;
            return (
              <li key={row.productId} className="flex items-center gap-3 px-4 py-3">
                <ProductImage
                  src={row.imageUrl}
                  alt={row.name}
                  size="sm"
                  fit="cover"
                  className="h-10 w-10 shrink-0 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/products/${row.productId}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="tabular text-xs">
                    <span className={out ? 'font-semibold text-destructive' : 'font-semibold text-warning'}>
                      {out ? 'Out of stock' : `${formatQuantity(row.available)} ${row.unitAbbreviation} left`}
                    </span>
                    <span className="text-muted-foreground"> · reorder at {formatQuantity(row.reorderLevel)}</span>
                  </p>
                </div>
                {canRestock && (
                  <Button asChild size="sm" variant={out ? 'default' : 'outline'} className="shrink-0">
                    <Link href={`/inventory?q=${encodeURIComponent(row.sku)}`}>Restock</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Slow movers                                                                */
/* -------------------------------------------------------------------------- */

export function SlowMovingPanel({ rows, currency }: { rows: DashboardOverview['slowMoving']; currency: string }) {
  return (
    <Panel
      title="Slow-moving products"
      description="Stock sitting on the shelf — candidates for a promo."
      action={<MoreLink href="/reports/slow-moving">View all</MoreLink>}
    >
      {rows.length === 0 ? (
        <PanelEmpty
          icon={TriangleAlert}
          title="Nothing slow moving"
          description="Every stocked product has sold recently."
        />
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.productId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${row.productId}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {row.name}
                </Link>
                <p className="tabular text-xs text-muted-foreground">
                  {formatQuantity(row.onHand)} in stock · {formatQuantity(row.unitsSold)} sold
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-sm font-semibold">
                  {row.daysSinceLastSale == null ? 'Never' : `${formatNumber(row.daysSinceLastSale, 0)}d`}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {row.daysSinceLastSale == null ? 'no sales' : 'since last sale'}
                </p>
              </div>
              <span className="tabular w-20 shrink-0 text-right text-sm text-muted-foreground">
                {formatCurrency(row.stockValue, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Recent transactions                                                        */
/* -------------------------------------------------------------------------- */

export function RecentTransactionsPanel({
  sales,
  currency,
  className,
}: {
  sales: DashboardOverview['recentSales'];
  currency: string;
  className?: string;
}) {
  return (
    <Panel
      title="Recent transactions"
      description="The latest sales in this period."
      action={<MoreLink href="/sales">View all</MoreLink>}
      className={className}
    >
      {sales.length === 0 ? (
        <PanelEmpty
          icon={ShoppingCart}
          title="No transactions yet"
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
                <th scope="col" className="px-4 py-2 font-medium">Receipt</th>
                <th scope="col" className="px-4 py-2 font-medium">Date</th>
                <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Cashier</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Items</th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Payment</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Total</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/sales/${sale.id}`}
                      className="whitespace-nowrap font-medium hover:underline"
                    >
                      {sale.invoiceNumber}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                    {formatDateTime(sale.createdAt)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                    {sale.cashierName}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">{formatNumber(sale.itemCount, 0)}</td>
                  <td className="hidden whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground md:table-cell">
                    {sale.paymentMethod ? humanizeEnum(sale.paymentMethod) : '—'}
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-2.5 text-right font-semibold">
                    {formatCurrency(sale.total, currency)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={SALE_STATUS_BADGE[sale.status]}>{SALE_STATUS_LABEL[sale.status]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
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

/* -------------------------------------------------------------------------- */
/* Quick actions                                                              */
/* -------------------------------------------------------------------------- */

export function QuickActionsPanel({
  canCreateProduct,
  canAdjustStock,
}: {
  canCreateProduct: boolean;
  canAdjustStock: boolean;
}) {
  const actions: { label: string; href: string; icon: LucideIcon; show: boolean }[] = [
    { label: 'Add product', href: '/products/new', icon: Plus, show: canCreateProduct },
    { label: 'Inventory', href: '/inventory', icon: Boxes, show: true },
    { label: 'Restock', href: '/inventory?status=LOW', icon: PackagePlus, show: canAdjustStock },
    { label: 'Sales report', href: '/reports/sales-summary', icon: BarChart3, show: true },
    { label: 'All sales', href: '/sales', icon: FileText, show: true },
  ].filter((action) => action.show);

  return (
    <Panel title="Quick actions" description="Jump straight to the thing you need.">
      <div className="p-4">
        <Button asChild size="lg" className="mb-3 h-12 w-full rounded-xl text-base">
          <Link href="/pos">
            <ShoppingCart /> New sale
          </Link>
        </Button>

        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              asChild
              variant="outline"
              className="h-auto flex-col items-start gap-1 rounded-lg px-3 py-3 text-left"
            >
              <Link href={action.href}>
                <action.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium">{action.label}</span>
              </Link>
            </Button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
