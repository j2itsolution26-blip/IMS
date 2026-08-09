import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, userCan } from '@/lib/session';
import { getSale } from '@/features/sales/queries';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDateTime, formatQuantity, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SaleActions } from '@/features/sales/sale-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const sale = await getSale(id);
  return { title: sale?.invoiceNumber ?? 'Sale' };
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('sales.view');
  const { id } = await params;

  const [sale, currency] = await Promise.all([getSale(id), getCurrency()]);
  if (!sale) notFound();

  return (
    <>
      <PageHeader
        title={sale.invoiceNumber}
        description={`${formatDateTime(sale.createdAt)} · ${sale.warehouse.name} · sold by ${sale.cashier.name}`}
        breadcrumbs={[{ label: 'Sales', href: '/sales' }, { label: sale.invoiceNumber }]}
        actions={
          <SaleActions
            sale={sale}
            currency={currency}
            canVoid={userCan(user, 'sales.delete')}
            canReturn={userCan(user, 'returns.create')}
          />
        }
      />

      {sale.status === 'VOIDED' && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          This sale has been voided. Stock was returned and it no longer counts toward revenue or profit.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Items</CardTitle>
            <Badge
              variant={
                sale.status === 'COMPLETED'
                  ? 'success'
                  : sale.status === 'VOIDED'
                    ? 'destructive'
                    : 'warning'
              }
            >
              {humanizeEnum(sale.status)}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Discount</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sale.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/products/${item.productId}`} className="font-medium hover:underline">
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {item.sku}
                        {item.returnedQuantity > 0 && (
                          <span className="ml-1 text-warning">
                            · {formatQuantity(item.returnedQuantity)} returned
                          </span>
                        )}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatQuantity(item.quantity)} {item.unit}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(item.unitPrice, currency)}
                    </TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">
                      {item.discount > 0 ? formatCurrency(item.discount, currency) : '—'}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatCurrency(item.total, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-right text-muted-foreground">
                    Subtotal
                  </TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(sale.subtotal, currency)}</TableCell>
                </TableRow>
                {sale.taxAmount > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      Tax
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(sale.taxAmount, currency)}
                    </TableCell>
                  </TableRow>
                )}
                {sale.discount > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      Order discount
                    </TableCell>
                    <TableCell className="tabular text-right">
                      − {formatCurrency(sale.discount, currency)}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="tabular text-right text-base font-bold">
                    {formatCurrency(sale.total, currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Customer">
                {sale.customer ? (
                  <Link href={`/customers/${sale.customer.id}`} className="hover:underline">
                    {sale.customer.name}
                  </Link>
                ) : (
                  'Walk-in'
                )}
              </Row>
              <Row label="Channel">{humanizeEnum(sale.channel)}</Row>
              <Row label="Paid">{formatCurrency(sale.paidAmount, currency)}</Row>
              {sale.changeAmount > 0 && <Row label="Change">{formatCurrency(sale.changeAmount, currency)}</Row>}
              {sale.balance > 0 && (
                <Row label="Balance due">
                  <span className="text-warning">{formatCurrency(sale.balance, currency)}</span>
                </Row>
              )}

              {userCan(user, 'reports.view') && (
                <>
                  <div className="border-t pt-2" />
                  <Row label="Cost of goods">{formatCurrency(sale.costOfGoods, currency)}</Row>
                  <Row label="Gross profit">
                    <span className={sale.profit < 0 ? 'text-destructive' : 'text-success'}>
                      {formatCurrency(sale.profit, currency)}
                    </span>
                  </Row>
                </>
              )}

              {sale.notes && (
                <p className="border-t pt-2 text-xs text-muted-foreground">{sale.notes}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {sale.payments.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {sale.payments.map((payment) => (
                    <li key={payment.id} className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block font-medium">{humanizeEnum(payment.method)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {payment.paymentNumber}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-medium">
                        {formatCurrency(payment.amount, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {sale.returns.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Returns</CardTitle>
                <CardDescription>Refunds recorded against this invoice.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {sale.returns.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <Link href={`/returns/${item.id}`} className="block font-medium hover:underline">
                          {item.returnNumber}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatDateTime(item.createdAt)}
                          {item.reason ? ` · ${item.reason}` : ''}
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-medium text-warning">
                        − {formatCurrency(item.total, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular truncate text-right font-medium">{children}</span>
    </div>
  );
}
