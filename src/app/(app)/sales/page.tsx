import type { Metadata } from 'next';
import Link from 'next/link';
import { Receipt, ShoppingCart } from 'lucide-react';
import type { SaleStatus } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { listSales } from '@/features/sales/queries';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatCurrency, formatDateTime, humanizeEnum } from '@/lib/format';
import { SALE_STATUS_LABEL, SALE_STATUS_BADGE } from '@/lib/sale-status';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Sales' };
export const dynamic = 'force-dynamic';

const STATUSES: SaleStatus[] = ['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED'];

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

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(result.summary.revenue, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gross profit</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(result.summary.profit, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Invoices</p>
          <p className="mt-1 text-xl font-semibold">{result.summary.count.toLocaleString()}</p>
        </Card>
      </div>

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

      <div className="rounded-lg border">
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="hidden lg:table-cell">Cashier</TableHead>
                  <TableHead className="hidden md:table-cell">Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell>
                      <Link href={`/sales/${sale.id}`} className="font-medium hover:underline">
                        {sale.invoiceNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(sale.createdAt)} · {sale.itemCount} item
                        {sale.itemCount === 1 ? '' : 's'}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {sale.cashierName}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {sale.paymentMethod ? humanizeEnum(sale.paymentMethod) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="tabular font-medium">{formatCurrency(sale.total, currency)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SALE_STATUS_BADGE[sale.status]}>{SALE_STATUS_LABEL[sale.status]}</Badge>
                    </TableCell>
                  </TableRow>
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
