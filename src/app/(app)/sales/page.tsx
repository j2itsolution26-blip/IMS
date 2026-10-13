import type { Metadata } from 'next';
import Link from 'next/link';
import { Calculator, PackageCheck, Receipt, ShoppingCart, TrendingUp, Undo2 } from 'lucide-react';
import type { PaymentMethod, SaleStatus } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { listCashiers, listSales } from '@/features/sales/queries';
import { getCurrency } from '@/server/services/settings-service';
import { inlineLabel, resolveRangeFromParams } from '@/server/analytics/date-range';
import { getSalesOverview } from '@/server/analytics/sales-overview';
import { formatCurrency, formatNumber, humanizeEnum } from '@/lib/format';
import { SaleInvoiceRows } from '@/features/sales/sale-invoice-rows';
import { ExportMenu } from '@/features/sales/export-menu';
import {
  CategorySalesPanel,
  DailySalesPanel,
  HourlySalesPanel,
  MonthlySalesPanel,
  PaymentMethodsPanel,
  SalesComparisonPanel,
  SalesPerformancePanel,
  TopProductsPanel,
} from '@/features/sales/sales-analytics-panels';
import { SALE_STATUS_LABEL } from '@/lib/sale-status';
import { KpiCard } from '@/features/dashboard/kpi-card';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Sales' };
export const dynamic = 'force-dynamic';

const STATUSES: SaleStatus[] = ['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED'];
const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'GCASH'];

/** Column header treatment, shared by the nine headings below. */
const HEAD = 'h-11 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    method?: string;
    cashier?: string;
    period?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('sales.view');
  const params = await searchParams;

  const { period, range, custom } = resolveRangeFromParams(params, 'month');
  const currency = await getCurrency();

  // One pass for the analytics, one for the paged table beneath it.
  const [overview, cashiers, result] = await Promise.all([
    getSalesOverview(range),
    listCashiers(),
    listSales({
      search: params.q,
      status: STATUSES.includes(params.status as SaleStatus) ? (params.status as SaleStatus) : 'ALL',
      paymentMethod: PAYMENT_METHODS.includes(params.method as PaymentMethod)
        ? (params.method as PaymentMethod)
        : undefined,
      userId: params.cashier || undefined,
      from: range.from,
      to: range.to,
      page: Number(params.page) || 1,
    }),
  ]);

  const { current, change } = overview.summary;
  const label = inlineLabel(range);
  const comparison = `vs previous ${range.isCustom ? 'period' : label}`;

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track revenue, profit, transactions, and sales history.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker current={period} allowCustom customFrom={custom?.from} customTo={custom?.to} />
          <ExportMenu />
          {userCan(user, 'pos.create') && (
            <Button asChild size="lg" className="h-11 rounded-xl">
              <Link href="/pos">
                <ShoppingCart /> New sale
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <section aria-label="Sales summary" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          label="Sales"
          value={formatCurrency(current.revenue, currency)}
          icon={Receipt}
          change={change.revenue}
          changeLabel={comparison}
          series={overview.trend.map((point) => point.revenue)}
        />
        <KpiCard
          label="Profit"
          value={formatCurrency(current.netProfit, currency)}
          icon={TrendingUp}
          tone={current.netProfit < 0 ? 'destructive' : 'success'}
          change={change.netProfit}
          changeLabel={comparison}
          series={overview.trend.map((point) => point.profit)}
        />
        <KpiCard
          label="Transactions"
          value={formatNumber(current.transactionCount, 0)}
          icon={ShoppingCart}
          change={change.transactionCount}
          changeLabel={comparison}
          series={overview.trend.map((point) => point.orders)}
        />
        <KpiCard
          label="Average sale"
          value={formatCurrency(current.averageOrderValue, currency)}
          icon={Calculator}
          hint={`across ${formatNumber(current.transactionCount, 0)} sale${current.transactionCount === 1 ? '' : 's'}`}
        />
        <KpiCard
          label="Items sold"
          value={formatNumber(current.itemsSold, 0)}
          icon={PackageCheck}
          change={change.itemsSold}
          changeLabel={comparison}
          series={overview.trend.map((point) => point.units)}
        />
        <KpiCard
          label="Refunds"
          value={formatCurrency(current.returnsTotal, currency)}
          icon={Undo2}
          tone={current.returnsCount > 0 ? 'warning' : 'default'}
          hint={
            current.returnsCount > 0
              ? `${formatNumber(current.returnsCount, 0)} refunded`
              : 'No refunds in this period'
          }
          invertChange
        />
      </section>

      {/* Performance and payments */}
      <div className="mb-4 grid items-start gap-4 xl:grid-cols-5">
        <SalesPerformancePanel
          trend={overview.trend}
          granularity={overview.granularity}
          currency={currency}
          rangeLabel={range.label}
          className="xl:col-span-3"
        />
        <PaymentMethodsPanel payments={overview.payments} currency={currency} className="xl:col-span-2" />
      </div>

      {/* Daily, monthly and comparison */}
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <DailySalesPanel daily={overview.daily} currency={currency} />
        <MonthlySalesPanel monthly={overview.monthly} currency={currency} />
        <SalesComparisonPanel
          comparison={overview.monthComparison}
          labels={overview.monthLabels}
          currency={currency}
          className="lg:col-span-2 2xl:col-span-1"
        />
      </div>

      {/* Products, categories and trading hours */}
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <TopProductsPanel
          products={overview.topProducts}
          currency={currency}
          className="lg:col-span-2 2xl:col-span-1"
        />
        <CategorySalesPanel categories={overview.categories} currency={currency} />
        <HourlySalesPanel hourly={overview.hourly} currency={currency} rangeLabel={range.label} />
      </div>

      {/* Sales history */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Recent sales</h2>
          <p className="text-xs text-muted-foreground">
            Every invoice {label}. Voided sales are excluded from the totals above.
          </p>
        </div>
      </div>

      <div className="mb-4 rounded-xl border bg-card p-3 shadow-2xs [&>div]:mb-0">
        <FilterBar
          searchPlaceholder="Search invoice number…"
          selects={[
            {
              name: 'cashier',
              label: 'Cashier',
              allLabel: 'All cashiers',
              width: 'w-[170px]',
              options: cashiers.map((cashier) => ({ value: cashier.id, label: cashier.name })),
            },
            {
              name: 'method',
              label: 'Payment',
              allLabel: 'All payments',
              width: 'w-[150px]',
              options: PAYMENT_METHODS.map((method) => ({ value: method, label: humanizeEnum(method) })),
            },
            {
              name: 'status',
              label: 'Status',
              allLabel: 'All statuses',
              width: 'w-[180px]',
              options: STATUSES.map((status) => ({ value: status, label: SALE_STATUS_LABEL[status] })),
            },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-2xs">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No sales in this period"
            description="Complete a sale at the POS and it will appear here with its full line detail, payments, and profit."
            action={
              userCan(user, 'pos.create') && (
                <Button asChild>
                  <Link href="/pos">Open the POS</Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* Every column stays present at every width and the table scrolls
                sideways instead, rather than dropping the unit price, cashier,
                or payment method on a narrow screen. */}
            <Table className="min-w-[1000px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className={HEAD}>Invoice</TableHead>
                  <TableHead className={HEAD}>Item</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Qty</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Unit price</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Line total</TableHead>
                  <TableHead className={HEAD}>Cashier</TableHead>
                  <TableHead className={HEAD}>Payment</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Invoice total</TableHead>
                  <TableHead className={HEAD}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((sale) => (
                  <SaleInvoiceRows key={sale.id} sale={sale} currency={currency} />
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
