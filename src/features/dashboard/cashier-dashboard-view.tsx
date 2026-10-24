import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  Clock,
  PackageCheck,
  PackageSearch,
  Receipt,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react';
import type { SaleStatus } from '@prisma/client';
import type { CashierDashboardData, CashierRecentSale } from '@/server/analytics/cashier-dashboard';
import { formatCurrency, formatDateTime, formatNumber, formatTime } from '@/lib/format';
import { formatPieces } from '@/lib/quantity';
import { cn } from '@/lib/utils';
import { Panel, PanelEmpty } from '@/components/panel';
import { ProductImage } from '@/components/product-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PosQuickAccess } from '@/features/dashboard/pos-quick-access';

/**
 * The Cashier dashboard: the way into the till, the cashier's own takings,
 * and what is running out.
 *
 * Every money figure is the signed-in cashier's own — their transactions,
 * their drawer cash — read on the server by `getCashierDashboard`. It carries
 * no store-wide revenue, cost or profit; the page never queries them for a
 * cashier.
 */

const STATUS: Record<SaleStatus, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  COMPLETED: { label: 'Completed', variant: 'success' },
  PARTIALLY_RETURNED: { label: 'Partly refunded', variant: 'warning' },
  RETURNED: { label: 'Refunded', variant: 'warning' },
  VOIDED: { label: 'Voided', variant: 'destructive' },
};

const METHOD: Record<string, string> = { CASH: 'Cash', GCASH: 'GCash', CARD: 'Card', OTHER: 'Other', Split: 'Split' };

export function CashierDashboardView({
  cashierName,
  data,
  currency,
  canSell,
  canViewSales,
  canViewInventory,
  suggestedOpeningCash,
}: {
  cashierName: string;
  data: CashierDashboardData;
  currency: string;
  canSell: boolean;
  canViewSales: boolean;
  canViewInventory: boolean;
  /** Settings › suggested starting cash, shown as a hint when opening a shift. */
  suggestedOpeningCash: number;
}) {
  const { shift } = data;
  const cashHint =
    data.cashWindow.kind === 'shift'
      ? `This shift, since ${formatTime(data.cashWindow.since)}`
      : 'Today · no shift open';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title sm:text-title-lg">Cashier Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hello, <span className="font-medium text-foreground">{cashierName}</span>. Your sales and what is running out.
          </p>
        </div>
        <ShiftStatus openedAt={shift?.openedAt ?? null} />
      </div>

      {canSell && (
        <PosQuickAccess currency={currency} hasOpenShift={shift !== null} suggestedOpeningCash={suggestedOpeningCash} />
      )}

      {shift && data.shiftSummary && (
        <ShiftCard cashierName={cashierName} shift={shift} summary={data.shiftSummary} currency={currency} />
      )}

      <section aria-label="Your figures and stock" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Transactions today"
          value={formatNumber(data.transactionsToday, 0)}
          hint="Your completed sales"
          icon={ShoppingCart}
        />
        <Stat
          label="Cash collected"
          value={formatCurrency(data.cashCollected, currency)}
          hint={cashHint}
          icon={Banknote}
        />
        <Stat
          label="Products available"
          value={formatNumber(data.productsAvailable, 0)}
          hint="Active and in stock"
          icon={PackageCheck}
        />
        <Stat
          label="Low stock alerts"
          value={formatNumber(data.lowStockAlerts, 0)}
          hint={data.outOfStock > 0 ? `${formatNumber(data.outOfStock, 0)} out of stock` : 'At or below reorder level'}
          icon={TriangleAlert}
          tone={data.outOfStock > 0 ? 'destructive' : data.lowStockAlerts > 0 ? 'warning' : 'default'}
          href={canViewInventory ? '/inventory?status=LOW_ANY' : undefined}
        />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <RecentTransactions
          sales={data.recentSales}
          currency={currency}
          canViewSales={canViewSales}
          canSell={canSell}
          className="lg:col-span-3"
        />
        <StockAlerts alerts={data.stockAlerts} canViewInventory={canViewInventory} className="lg:col-span-2" />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ShiftStatus({ openedAt }: { openedAt: Date | null }) {
  if (openedAt) {
    return (
      <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-sm font-medium text-success-text">
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
        Shift open since {formatTime(openedAt)}
      </span>
    );
  }
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded-full border bg-muted px-3 text-sm font-medium text-muted-foreground">
      <Clock className="h-4 w-4" aria-hidden="true" /> No shift open
    </span>
  );
}

/**
 * The open shift's drawer, kept apart from the day's figures above: a shift
 * can start mid-day, and only cash belongs in the drawer.
 */
function ShiftCard({
  cashierName,
  shift,
  summary,
  currency,
}: {
  cashierName: string;
  shift: NonNullable<CashierDashboardData['shift']>;
  summary: NonNullable<CashierDashboardData['shiftSummary']>;
  currency: string;
}) {
  const rows: [string, string][] = [
    ['Starting cash', formatCurrency(summary.openingCash, currency)],
    ['Cash sales this shift', formatCurrency(summary.cashSales, currency)],
    ['Cash in / out', `+${formatCurrency(summary.cashIn, currency)} / −${formatCurrency(summary.cashOut, currency)}`],
    ['Cash refunds', `−${formatCurrency(summary.cashRefunds, currency)}`],
  ];
  return (
    <section aria-labelledby="shift-card-title" className="mb-4 rounded-xl border bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="shift-card-title" className="text-base font-semibold">
            Current shift
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {cashierName} · opened {formatDateTime(shift.openedAt)} · {formatNumber(summary.transactionCount, 0)} sale
            {summary.transactionCount === 1 ? '' : 's'} ({formatCurrency(summary.totalSales, currency)} all payments)
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success-text">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" /> Open
        </span>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="tabular truncate text-sm font-semibold">{value}</dd>
          </div>
        ))}
        <div className="min-w-0 rounded-lg bg-primary/10 px-3 py-2 lg:-my-2">
          <dt className="text-xs font-medium text-primary">Expected in drawer</dt>
          <dd className="tabular text-lg font-bold text-primary">{formatCurrency(summary.expectedCash, currency)}</dd>
        </div>
      </dl>
    </section>
  );
}

const STAT_TONE = {
  default: 'bg-primary/10 text-primary',
  warning: 'bg-warning/15 text-warning-text',
  destructive: 'bg-destructive/10 text-destructive-text',
} as const;

/**
 * A compact headline figure. Sized for two to a row on a phone, where the
 * dashboard-wide KPI card's large numerals would not fit a currency amount.
 */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONE;
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        'flex h-full min-w-0 flex-col rounded-xl border bg-card p-3 shadow-card transition-colors sm:p-4',
        href && 'hover:border-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground sm:text-xs">
          {label}
        </p>
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8', STAT_TONE[tone])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="tabular mt-2 break-words text-xl font-bold leading-tight tracking-tight sm:text-2xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

function RecentTransactions({
  sales,
  currency,
  canViewSales,
  canSell,
  className,
}: {
  sales: CashierRecentSale[];
  currency: string;
  canViewSales: boolean;
  canSell: boolean;
  className?: string;
}) {
  return (
    <Panel
      title="Your recent transactions"
      description="Your latest receipts, voided and refunded ones included."
      className={className}
      action={
        canViewSales && sales.length > 0 ? (
          <Link href="/sales" className="inline-flex min-h-9 items-center text-xs font-semibold text-primary hover:underline">
            View all
          </Link>
        ) : undefined
      }
    >
      {sales.length === 0 ? (
        <PanelEmpty
          icon={Receipt}
          title="No transactions yet"
          description="Sales you ring up at the POS appear here with their receipts."
          action={
            canSell ? (
              <Button asChild size="sm">
                <Link href="/pos">Open the POS</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y">
          {sales.map((sale) => {
            const status = STATUS[sale.status];
            return (
              <li key={sale.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-medium">{sale.invoiceNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(sale.createdAt)}
                    {sale.paymentMethod ? ` · ${METHOD[sale.paymentMethod] ?? sale.paymentMethod}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn(
                      'tabular text-sm font-semibold',
                      sale.status === 'VOIDED' && 'text-muted-foreground line-through',
                    )}
                  >
                    {formatCurrency(sale.total, currency)}
                  </span>
                  <Badge variant={status.variant} className="px-2 py-0 text-[11px]">
                    {status.label}
                  </Badge>
                </div>
                {canViewSales && (
                  <Button asChild variant="ghost" size="sm" className="h-10 shrink-0 px-2.5">
                    <Link href={`/sales/${sale.id}`} aria-label={`View receipt ${sale.invoiceNumber}`}>
                      <Receipt /> <span className="hidden sm:inline">Receipt</span>
                    </Link>
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

function StockAlerts({
  alerts,
  canViewInventory,
  className,
}: {
  alerts: CashierDashboardData['stockAlerts'];
  canViewInventory: boolean;
  className?: string;
}) {
  return (
    <Panel
      title="Inventory alerts"
      description="Out of stock first, then low. Tell a customer before ringing up a large order."
      className={className}
      action={
        canViewInventory ? (
          <Link
            href="/inventory?status=LOW_ANY"
            className="inline-flex min-h-9 items-center text-xs font-semibold text-primary hover:underline"
          >
            View Inventory
          </Link>
        ) : undefined
      }
    >
      {alerts.length === 0 ? (
        <PanelEmpty icon={PackageSearch} title="Everything is in stock" description="No product is at or below its reorder level." />
      ) : (
        <ul className="divide-y">
          {alerts.map((row) => {
            const out = row.available <= 0;
            return (
              <li key={row.productId} className="flex items-center gap-3 px-4 py-2.5">
                <ProductImage src={row.imageUrl} alt={row.name} size="sm" className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.code}
                    {row.threshold > 0 ? ` · reorder at ${formatPieces(row.threshold)}` : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'tabular shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                    out ? 'bg-destructive/10 text-destructive-text' : 'bg-warning/15 text-warning-text',
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
  );
}
