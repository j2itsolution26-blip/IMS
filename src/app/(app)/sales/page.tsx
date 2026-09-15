import type { Metadata } from 'next';
import Link from 'next/link';
import { Receipt, ShoppingCart } from 'lucide-react';
import type { SaleStatus } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { listSales } from '@/features/sales/queries';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatCurrency } from '@/lib/format';
import { SaleInvoiceRows } from '@/features/sales/sale-invoice-rows';
import { SALE_STATUS_LABEL } from '@/lib/sale-status';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Sales' };
export const dynamic = 'force-dynamic';

const STATUSES: SaleStatus[] = ['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED'];

/** Column header treatment, shared by the nine headings below. */
const HEAD = 'h-11 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; period?: string; page?: string }>;
}) {
  const user = await requirePermission('sales.view');
  const params = await searchParams;

  const period = parsePeriod(params.period, 'last30');
  const range = resolveRange(period);
  const currency = await getCurrency();

  const result = await listSales({
    search: params.q,
    status: STATUSES.includes(params.status as SaleStatus) ? (params.status as SaleStatus) : 'ALL',
    from: range.from,
    to: range.to,
    page: Number(params.page) || 1,
  });

  return (
    <>
      <PageHeader
        title="Sales"
        description={`Invoices recorded ${range.label.toLowerCase()}. Voided sales are excluded from the totals.`}
        actions={
          <>
            <PeriodPicker current={period} />
            {userCan(user, 'pos.create') && (
              <Button asChild>
                <Link href="/pos">
                  <ShoppingCart /> New sale
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Styling here is applied per instance rather than to the shared Card,
          Table, and FilterBar components, which a dozen other pages render. */}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="h-full p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Revenue
          </p>
          <p className="tabular mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {formatCurrency(result.summary.revenue, currency)}
          </p>
        </Card>
        <Card className="h-full p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Gross profit
          </p>
          <p className="tabular mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {formatCurrency(result.summary.profit, currency)}
          </p>
        </Card>
        <Card className="h-full p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Invoices
          </p>
          <p className="tabular mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {result.summary.count.toLocaleString()}
          </p>
        </Card>
      </div>

      {/* The filter row sits on its own surface so it reads as a toolbar rather
          than as loose controls. The child override cancels FilterBar's own
          bottom margin, which belongs to the layouts that use it bare. */}
      <div className="mb-4 rounded-xl border bg-card p-3 shadow-sm [&>div]:mb-0">
        <FilterBar
          searchPlaceholder="Search invoice number…"
          selects={[
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

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
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
