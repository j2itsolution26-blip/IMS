import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, userCan } from '@/lib/session';
import { getPurchaseOrder } from '@/features/purchases/queries';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDate, formatDateTime, formatQuantity, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PurchaseActions } from '@/features/purchases/purchase-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const order = await getPurchaseOrder(id);
  return { title: order?.orderNumber ?? 'Purchase order' };
}

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('purchases.view');
  const { id } = await params;

  const [order, currency] = await Promise.all([getPurchaseOrder(id), getCurrency()]);
  if (!order) notFound();

  const ordered = order.items.reduce((acc, item) => acc + item.quantity, 0);
  const received = order.items.reduce((acc, item) => acc + item.receivedQuantity, 0);
  const receivedPercent = ordered > 0 ? Math.round((received / ordered) * 100) : 0;

  const isLate =
    order.expectedDate &&
    order.expectedDate.getTime() < Date.now() &&
    (order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED');

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        description={`${order.supplier.name} · raised ${formatDate(order.createdAt)} by ${order.raisedBy.name} · delivering to ${order.warehouse.name}`}
        breadcrumbs={[{ label: 'Purchases', href: '/purchases' }, { label: order.orderNumber }]}
        actions={
          <PurchaseActions
            order={order}
            currency={currency}
            canReceive={userCan(user, 'purchases.update')}
            canPay={userCan(user, 'payments.create')}
            canCancel={userCan(user, 'purchases.delete')}
          />
        }
      />

      {isLate && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          This delivery was expected on {formatDate(order.expectedDate)} and has not been fully received.
        </div>
      )}

      {order.status === 'CANCELLED' && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          This purchase order was cancelled. No stock was received against it.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Order lines</CardTitle>
            <Badge
              variant={
                order.status === 'RECEIVED'
                  ? 'success'
                  : order.status === 'CANCELLED'
                    ? 'destructive'
                    : order.status === 'PARTIALLY_RECEIVED'
                      ? 'warning'
                      : 'default'
              }
            >
              {humanizeEnum(order.status)}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/products/${item.productId}`} className="font-medium hover:underline">
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatQuantity(item.quantity)} {item.unit}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`tabular ${
                          item.outstanding > 0 ? 'text-warning' : 'text-success'
                        } font-medium`}
                      >
                        {formatQuantity(item.receivedQuantity)}
                      </span>
                      {item.outstanding > 0 && (
                        <span className="tabular block text-xs text-muted-foreground">
                          {formatQuantity(item.outstanding)} outstanding
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(item.unitCost, currency)}
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
                  <TableCell className="tabular text-right">{formatCurrency(order.subtotal, currency)}</TableCell>
                </TableRow>
                {order.taxAmount > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      Tax
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(order.taxAmount, currency)}
                    </TableCell>
                  </TableRow>
                )}
                {order.shippingCost > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      Shipping
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(order.shippingCost, currency)}
                    </TableCell>
                  </TableRow>
                )}
                {order.discount > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      Discount
                    </TableCell>
                    <TableCell className="tabular text-right">
                      − {formatCurrency(order.discount, currency)}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="tabular text-right text-base font-bold">
                    {formatCurrency(order.total, currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Received</span>
                  <span className="tabular font-medium">{receivedPercent}%</span>
                </div>
                <Progress
                  value={receivedPercent}
                  indicatorClassName={receivedPercent === 100 ? 'bg-success' : 'bg-primary'}
                />
                <p className="tabular mt-1 text-xs text-muted-foreground">
                  {formatQuantity(received)} of {formatQuantity(ordered)} units
                </p>
              </div>

              <div className="space-y-2 border-t pt-3 text-sm">
                <Row label="Expected">{order.expectedDate ? formatDate(order.expectedDate) : '—'}</Row>
                <Row label="Received on">{order.receivedDate ? formatDate(order.receivedDate) : '—'}</Row>
                <Row label="Paid">{formatCurrency(order.paidAmount, currency)}</Row>
                {order.balance > 0 && (
                  <Row label="Outstanding">
                    <span className="text-warning">{formatCurrency(order.balance, currency)}</span>
                  </Row>
                )}
              </div>

              {order.notes && <p className="border-t pt-3 text-xs text-muted-foreground">{order.notes}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Supplier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Name">{order.supplier.name}</Row>
              <Row label="Code">{order.supplier.code}</Row>
              {order.supplier.phone && <Row label="Phone">{order.supplier.phone}</Row>}
              {order.supplier.email && <Row label="Email">{order.supplier.email}</Row>}
              {order.supplier.leadTimeDays > 0 && (
                <Row label="Lead time">{order.supplier.leadTimeDays} days</Row>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {order.payments.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">Nothing paid yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {order.payments.map((payment) => (
                    <li key={payment.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{humanizeEnum(payment.method)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatDateTime(payment.createdAt)}
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
