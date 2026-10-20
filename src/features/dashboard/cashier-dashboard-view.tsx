import Link from 'next/link';
import { Clock, PackageCheck, PackageX, Receipt, ScanBarcode, ShoppingCart, TriangleAlert } from 'lucide-react';
import type { InventoryKpis } from '@/server/analytics/inventory-dashboard';
import type { StockLevelRow } from '@/server/analytics/inventory-analytics';
import type { OpenShiftSummary, ShiftCloseSummary } from '@/server/services/shift-service';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import { formatPieces } from '@/lib/quantity';
import { cn } from '@/lib/utils';
import { Panel, PanelEmpty } from '@/components/panel';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/features/dashboard/kpi-card';

/**
 * The Cashier dashboard: what someone at the till needs before and during a
 * shift. Their own shift's takings, which products are running out (so a
 * customer can be told before checkout), and the way to the POS.
 *
 * It deliberately carries no store-wide revenue, cost or profit. The page
 * that renders it never queries them for a cashier.
 */
export function CashierDashboardView({
  cashierName,
  shift,
  shiftTotals,
  kpis,
  runningOut,
  canSell,
  currency,
}: {
  cashierName: string;
  shift: OpenShiftSummary | null;
  /** Totals for the cashier's own open shift only. */
  shiftTotals: ShiftCloseSummary | null;
  kpis: InventoryKpis;
  runningOut: StockLevelRow[];
  canSell: boolean;
  currency: string;
}) {
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Till Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hello, <span className="font-medium text-foreground">{cashierName}</span>. Your shift and what is running out.
          </p>
        </div>
        {canSell && (
          <Button asChild size="lg" className="h-11 rounded-xl">
            <Link href="/pos">
              <ScanBarcode /> Open POS
            </Link>
          </Button>
        )}
      </div>

      <section aria-label="Your shift and stock availability" className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {shift && shiftTotals ? (
          <>
            <KpiCard
              label="Your shift sales"
              value={formatCurrency(shiftTotals.totalSales, currency)}
              icon={Receipt}
              hint={`Since ${formatDateTime(shift.openedAt)}`}
            />
            <KpiCard
              label="Your transactions"
              value={formatNumber(shiftTotals.transactionCount, 0)}
              icon={ShoppingCart}
              hint="This shift"
            />
          </>
        ) : (
          <div className="flex flex-col justify-between rounded-xl border border-dashed bg-card p-4 min-[420px]:col-span-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> No shift open
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a shift at the POS with your starting cash. Your sales for the shift will show here.
            </p>
          </div>
        )}
        <KpiCard
          label="Low stock"
          value={formatNumber(kpis.lowStock, 0)}
          icon={TriangleAlert}
          tone={kpis.lowStock > 0 ? 'warning' : 'default'}
          hint="Running out — tell the owner"
          href="/inventory?status=LOW_ANY"
        />
        <KpiCard
          label="Out of stock"
          value={formatNumber(kpis.outOfStock, 0)}
          icon={PackageX}
          tone={kpis.outOfStock > 0 ? 'destructive' : 'default'}
          hint={kpis.outOfStock > 0 ? 'Cannot be sold right now' : 'Everything can be sold'}
          href="/inventory?status=OUT_OF_STOCK"
        />
      </section>

      <Panel
        title="Running out"
        description="Out of stock first, then low. Check these before ringing up a large order."
        action={
          <Link href="/inventory?status=LOW_ANY" className="text-xs font-semibold text-primary hover:underline">
            View all
          </Link>
        }
      >
        {runningOut.length === 0 ? (
          <PanelEmpty icon={PackageCheck} title="Everything is in stock" description="No product is at or below its low-stock level." />
        ) : (
          <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
            {runningOut.map((row) => {
              const out = row.available <= 0;
              return (
                <li key={row.productId} className="flex items-center gap-3 px-4 py-2.5 sm:border-b">
                  <ProductImage src={row.imageUrl} alt={row.name} size="sm" className="h-9 w-9 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/products/${row.productId}`} className="block truncate text-sm font-medium hover:underline">
                      {row.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{row.barcode ?? row.sku}</p>
                  </div>
                  <span
                    className={cn(
                      'tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                      out ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-warning',
                    )}
                  >
                    {out ? 'Out of stock' : `${formatPieces(row.available)} left`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
