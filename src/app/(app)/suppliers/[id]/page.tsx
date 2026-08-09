import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Clock, Mail, MapPin, Package, Phone, Truck } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDate, formatPercent, formatQuantity, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { name: true } });
  return { title: supplier?.name ?? 'Supplier' };
}

/**
 * Supplier detail: spend, delivery reliability, what they supply, and what is
 * still owed. On-time rate is computed from received vs expected dates on the
 * orders themselves rather than being recorded anywhere.
 */
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('suppliers.view');
  const { id } = await params;

  const [supplier, currency] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id },
      include: {
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            paidAmount: true,
            createdAt: true,
            expectedDate: true,
            receivedDate: true,
            _count: { select: { items: true } },
          },
        },
        products: {
          where: { status: 'ACTIVE' },
          orderBy: { name: 'asc' },
          take: 50,
          select: {
            id: true,
            name: true,
            sku: true,
            costPrice: true,
            reorderLevel: true,
            inventory: { select: { quantity: true, reserved: true } },
          },
        },
      },
    }),
    getCurrency(),
  ]);

  if (!supplier) notFound();

  const [spend, allOrders] = await Promise.all([
    prisma.purchaseOrder.aggregate({
      where: { supplierId: id, status: { not: 'CANCELLED' } },
      _sum: { total: true, paidAmount: true },
      _count: true,
    }),
    prisma.purchaseOrder.findMany({
      where: { supplierId: id, receivedDate: { not: null } },
      select: { expectedDate: true, receivedDate: true, createdAt: true },
    }),
  ]);

  const totalSpend = toNum(spend._sum.total);
  const outstanding = Math.max(0, totalSpend - toNum(spend._sum.paidAmount));

  // On-time means received on or before the promised date. Orders with no
  // expected date are treated as on time — there was nothing to miss.
  const onTime = allOrders.filter(
    (order) => !order.expectedDate || order.receivedDate! <= order.expectedDate,
  ).length;
  const onTimeRate = allOrders.length > 0 ? (onTime / allOrders.length) * 100 : null;

  const averageLeadDays =
    allOrders.length > 0
      ? allOrders.reduce(
          (acc, order) =>
            acc + (order.receivedDate!.getTime() - order.createdAt.getTime()) / 86_400_000,
          0,
        ) / allOrders.length
      : null;

  return (
    <>
      <PageHeader
        title={supplier.name}
        description={`Supplier ${supplier.code}${supplier.contactName ? ` · ${supplier.contactName}` : ''}`}
        breadcrumbs={[{ label: 'Suppliers', href: '/suppliers' }, { label: supplier.name }]}
        actions={
          <>
            <Badge variant={supplier.isActive ? 'success' : 'secondary'}>
              {supplier.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {userCan(user, 'purchases.create') && supplier.isActive && (
              <Button asChild>
                <Link href="/purchases/new">
                  <Truck /> New order
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total spend" value={formatCurrency(totalSpend, currency)} icon={Truck} />
        <StatCard label="Orders" value={String(spend._count)} />
        <StatCard
          label="On-time delivery"
          value={onTimeRate == null ? '—' : formatPercent(onTimeRate, 0)}
          tone={onTimeRate == null ? 'default' : onTimeRate >= 90 ? 'success' : onTimeRate >= 70 ? 'warning' : 'destructive'}
          icon={Clock}
          hint={
            averageLeadDays != null
              ? `${averageLeadDays.toFixed(1)} day average lead time`
              : 'No deliveries received yet'
          }
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(outstanding, currency)}
          tone={outstanding > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Purchase history</CardTitle>
              <CardDescription>
                {spend._count > 25 ? `Most recent 25 of ${spend._count} orders.` : 'All orders raised with this supplier.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {supplier.purchaseOrders.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  title="No orders yet"
                  description="Purchase orders raised with this supplier will appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead className="hidden sm:table-cell">Expected</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplier.purchaseOrders.map((order) => {
                      const late =
                        order.expectedDate &&
                        !order.receivedDate &&
                        order.expectedDate.getTime() < Date.now() &&
                        order.status !== 'CANCELLED';
                      const balance = toNum(order.total) - toNum(order.paidAmount);

                      return (
                        <TableRow key={order.id}>
                          <TableCell>
                            <Link href={`/purchases/${order.id}`} className="font-medium hover:underline">
                              {order.orderNumber}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(order.createdAt)} · {order._count.items} line
                              {order._count.items === 1 ? '' : 's'}
                            </p>
                          </TableCell>
                          <TableCell className="hidden text-sm sm:table-cell">
                            <span className={late ? 'font-medium text-warning' : 'text-muted-foreground'}>
                              {order.expectedDate ? formatDate(order.expectedDate) : '—'}
                            </span>
                            {late && <span className="block text-xs text-warning">overdue</span>}
                          </TableCell>
                          <TableCell>
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
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="tabular font-medium">
                              {formatCurrency(toNum(order.total), currency)}
                            </span>
                            {balance > 0 && order.status !== 'CANCELLED' && (
                              <span className="tabular block text-xs text-warning">
                                {formatCurrency(balance, currency)} unpaid
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Products supplied</CardTitle>
              <CardDescription>Active products assigned to this supplier.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {supplier.products.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title="No products assigned"
                  description="Set this supplier on a product to see it listed here and to get reorder suggestions grouped by supplier."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">In stock</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplier.products.map((product) => {
                      const onHand = product.inventory.reduce((acc, row) => acc + toNum(row.quantity), 0);
                      const reserved = product.inventory.reduce((acc, row) => acc + toNum(row.reserved), 0);
                      const available = onHand - reserved;
                      const threshold = toNum(product.reorderLevel);
                      const low = threshold > 0 && available <= threshold;

                      return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <Link href={`/products/${product.id}`} className="font-medium hover:underline">
                              {product.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">{product.sku}</p>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`tabular ${low ? 'font-medium text-warning' : ''}`}>
                              {formatQuantity(available)}
                            </span>
                            {low && <span className="block text-xs text-warning">at/below reorder</span>}
                          </TableCell>
                          <TableCell className="tabular text-right">
                            {formatCurrency(toNum(product.costPrice), currency)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {supplier.contactName && <p className="font-medium">{supplier.contactName}</p>}
              {supplier.phone && (
                <p className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a href={`tel:${supplier.phone}`} className="hover:underline">
                    {supplier.phone}
                  </a>
                </p>
              )}
              {supplier.email && (
                <p className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a href={`mailto:${supplier.email}`} className="truncate hover:underline">
                    {supplier.email}
                  </a>
                </p>
              )}
              {supplier.address && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">{supplier.address}</span>
                </p>
              )}
              {supplier.taxNumber && <p className="text-muted-foreground">Tax number: {supplier.taxNumber}</p>}
              {!supplier.phone && !supplier.email && !supplier.address && !supplier.contactName && (
                <p className="text-muted-foreground">No contact details recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Agreed lead time">
                {supplier.leadTimeDays > 0 ? `${supplier.leadTimeDays} days` : 'Not set'}
              </Row>
              <Row label="Actual average">
                {averageLeadDays != null ? `${averageLeadDays.toFixed(1)} days` : '—'}
              </Row>
              <Row label="Products">{supplier.products.length}</Row>
              <Row label="Added">{formatDate(supplier.createdAt)}</Row>
            </CardContent>
          </Card>

          {supplier.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{supplier.notes}</p>
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
      <span className="tabular font-medium">{children}</span>
    </div>
  );
}
