import type { PaymentMethod } from '@prisma/client';
import Link from 'next/link';
import { listCashiers, listSales } from '@/features/sales/queries';
import { ViewSaleButton } from '@/features/dashboard/view-sale-button';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDateTime, formatNumber, humanizeEnum } from '@/lib/format';
import { SALE_STATUS_BADGE, SALE_STATUS_LABEL } from '@/lib/sale-status';

/** Only the methods the till can actually record. */
const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'GCASH'];

function parsePaymentMethod(value: string | undefined): PaymentMethod | undefined {
  return PAYMENT_METHODS.includes(value as PaymentMethod) ? (value as PaymentMethod) : undefined;
}

/**
 * Past transactions for the period the dashboard is showing.
 *
 * The date range comes from the dashboard's own period selector rather than a
 * second set of date controls, so the table can never disagree with the
 * figures above it.
 */
export async function SalesHistory({
  from,
  to,
  rangeLabel,
  currency,
  search,
  paymentMethod,
  cashierId,
  page,
}: {
  from: Date;
  to: Date;
  rangeLabel: string;
  currency: string;
  search?: string;
  paymentMethod?: string;
  cashierId?: string;
  page?: string;
}) {
  const [cashiers, result] = await Promise.all([
    listCashiers(),
    listSales({
      from,
      to,
      search,
      paymentMethod: parsePaymentMethod(paymentMethod),
      userId: cashierId || undefined,
      page: Number(page) || 1,
      pageSize: 10,
    }),
  ]);

  return (
    <section aria-labelledby="sales-history-heading" className="mb-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle id="sales-history-heading" className="text-base">
            Sales history
          </CardTitle>
          <CardDescription>{rangeLabel} · change the period above to look further back.</CardDescription>
        </CardHeader>

        <div className="px-6">
          <FilterBar
            searchPlaceholder="Search receipt number…"
            selects={[
              {
                name: 'method',
                label: 'Payment',
                allLabel: 'All payments',
                width: 'w-[150px]',
                options: PAYMENT_METHODS.map((method) => ({
                  value: method,
                  label: humanizeEnum(method),
                })),
              },
              {
                name: 'cashier',
                label: 'Cashier',
                allLabel: 'All cashiers',
                width: 'w-[170px]',
                options: cashiers.map((cashier) => ({
                  value: cashier.id,
                  label: cashier.name,
                })),
              },
            ]}
          />
        </div>

        {result.rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">No sales recorded</p>
        ) : (
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden md:table-cell">Payment</TableHead>
                  <TableHead className="hidden lg:table-cell">Cashier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(sale.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/sales/${sale.id}`}
                        className="whitespace-nowrap font-medium hover:underline"
                      >
                        {sale.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNumber(sale.itemCount, 0)}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right font-medium">
                      {formatCurrency(sale.total, currency)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {sale.paymentMethod ? humanizeEnum(sale.paymentMethod) : '—'}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                      {sale.cashierName}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SALE_STATUS_BADGE[sale.status]}>{SALE_STATUS_LABEL[sale.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ViewSaleButton saleId={sale.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </div>
        )}
      </Card>
    </section>
  );
}
