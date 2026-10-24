import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser, requirePermission, userCan } from '@/lib/session';
import { canViewSaleRecord } from '@/lib/sales-scope';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { formatPieces } from '@/lib/quantity';
import { getSale, getReceiptData } from '@/features/sales/queries';
import { getCompanyProfile, getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDateTime, humanizeEnum } from '@/lib/format';
import { SALE_STATUS_LABEL, SALE_STATUS_BADGE } from '@/lib/sale-status';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductImage } from '@/components/product-image';
import { SaleActions } from '@/features/sales/sale-actions';
import { ReceiptButton } from '@/features/sales/receipt-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await getCurrentUser();
  if (!user || user.isLocked || user.mustChangePassword || !userCan(user, 'sales.view')) return { title: 'Sale' };
  const { id } = await params;
  const sale = await getSale(id);
  // Same rule as the page: another cashier's invoice number is not named.
  return { title: sale && canViewSaleRecord(user, sale.cashier.id) ? sale.invoiceNumber : 'Sale' };
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('sales.view');
  const { id } = await params;
  // Cost of goods and profit are the owner's; getSale zeroes them otherwise.
  const canViewCost = userCan(user, FINANCIAL_PERMISSION);

  const [sale, currency, company] = await Promise.all([
    getSale(id, { includeCost: canViewCost }),
    getCurrency(),
    getCompanyProfile(),
  ]);
  // A cashier may open only the sales they rang up. Another cashier's sale
  // answers as missing, so its existence is not confirmed either.
  if (!sale || !canViewSaleRecord(user, sale.cashier.id)) notFound();
  const receiptData = await getReceiptData(id);

  return (
    <>
      <PageHeader
        title={sale.invoiceNumber}
        description={`${formatDateTime(sale.createdAt)} · sold by ${sale.cashier.name}`}
        breadcrumbs={[{ label: 'Sales', href: '/sales' }, { label: sale.invoiceNumber }]}
        actions={
          <>
            {receiptData && (
              <ReceiptButton
                data={{
                  ...receiptData,
                  company: {
                    name: company.name,
                    address: company.address,
                    phone: company.phone,
                    receiptFooter: company.receiptFooter,
                  },
                  currency,
                }}
              />
            )}
            <SaleActions
              sale={sale}
              currency={currency}
              canVoid={userCan(user, 'sales.delete')}
              canReturn={userCan(user, 'returns.create')}
            />
          </>
        }
      />

      {sale.status === 'VOIDED' && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-text">
          This sale has been voided. Stock was returned and it no longer counts toward revenue or profit.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Items</CardTitle>
            <Badge variant={SALE_STATUS_BADGE[sale.status]}>{SALE_STATUS_LABEL[sale.status]}</Badge>
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
                      <div className="flex items-center gap-3">
                        <ProductImage
                          src={item.imageUrl}
                          alt={item.name}
                          size="sm"
                          className="h-11 w-11 rounded-lg"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/products/${item.productId}`}
                            className="font-medium hover:underline"
                          >
                            {item.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {item.sku}
                            {item.returnedQuantity > 0 && (
                              <span className="ml-1 text-warning-text">
                                · {formatPieces(item.returnedQuantity)} returned
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatPieces(item.quantity)}
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
              <Row label="Channel">{humanizeEnum(sale.channel)}</Row>
              <Row label="Paid">{formatCurrency(sale.paidAmount, currency)}</Row>
              {sale.changeAmount > 0 && <Row label="Change">{formatCurrency(sale.changeAmount, currency)}</Row>}
              {sale.balance > 0 && (
                <Row label="Balance due">
                  <span className="text-warning-text">{formatCurrency(sale.balance, currency)}</span>
                </Row>
              )}

              {canViewCost && (
                <>
                  <div className="border-t pt-2" />
                  <Row label="Cost of goods">{formatCurrency(sale.costOfGoods, currency)}</Row>
                  <Row label="Gross profit">
                    <span className={sale.profit < 0 ? 'text-destructive-text' : 'text-success-text'}>
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
                          {formatDateTime(item.createdAt)} · by {item.processedBy}
                          {item.reason ? ` · ${item.reason}` : ''}
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-medium text-warning-text">
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
