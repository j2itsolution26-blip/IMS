import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mail, MapPin, Phone, Receipt, RotateCcw, ShoppingCart } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDate, formatDateTime, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id }, select: { name: true } });
  return { title: customer?.name ?? 'Customer' };
}

/**
 * Customer detail: who they are, what they have bought, and what they owe.
 *
 * Every figure is aggregated from this customer's own sales — nothing is
 * denormalised onto the customer row, so it cannot drift.
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('customers.view');
  const { id } = await params;

  const [customer, currency] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        sales: {
          where: { status: { not: 'VOIDED' } },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            invoiceNumber: true,
            createdAt: true,
            status: true,
            total: true,
            paidAmount: true,
            taxAmount: true,
            costOfGoods: true,
            _count: { select: { items: true } },
          },
        },
        returns: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, returnNumber: true, createdAt: true, total: true, reason: true },
        },
      },
    }),
    getCurrency(),
  ]);

  if (!customer) notFound();

  // Lifetime figures come from an aggregate over all sales, not just the 25 listed.
  const [lifetime, firstSale] = await Promise.all([
    prisma.sale.aggregate({
      where: { customerId: id, status: { not: 'VOIDED' } },
      _sum: { total: true, paidAmount: true, taxAmount: true, costOfGoods: true },
      _count: true,
    }),
    prisma.sale.findFirst({
      where: { customerId: id, status: { not: 'VOIDED' } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const totalSpend = toNum(lifetime._sum.total);
  const totalPaid = toNum(lifetime._sum.paidAmount);
  const outstanding = Math.max(0, totalSpend - totalPaid);
  const profit = totalSpend - toNum(lifetime._sum.taxAmount) - toNum(lifetime._sum.costOfGoods);
  const orderCount = lifetime._count;

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`Customer ${customer.code}${firstSale ? ` · first purchase ${formatDate(firstSale.createdAt)}` : ' · no purchases yet'}`}
        breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: customer.name }]}
        actions={
          <Badge variant={customer.isActive ? 'success' : 'secondary'}>
            {customer.isActive ? 'Active' : 'Inactive'}
          </Badge>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Lifetime spend" value={formatCurrency(totalSpend, currency)} icon={ShoppingCart} />
        <StatCard label="Orders" value={String(orderCount)} icon={Receipt} />
        <StatCard
          label="Average order"
          value={formatCurrency(orderCount > 0 ? totalSpend / orderCount : 0, currency)}
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(outstanding, currency)}
          tone={outstanding > 0 ? 'warning' : 'success'}
          hint={
            toNum(customer.creditLimit) > 0
              ? `${formatCurrency(toNum(customer.creditLimit), currency)} credit limit`
              : 'No credit limit set'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Purchase history</CardTitle>
              <CardDescription>
                {orderCount > 25 ? `Most recent 25 of ${orderCount} orders.` : 'All recorded orders.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {customer.sales.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="No purchases yet"
                  description="Sales assigned to this customer at the till will appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="hidden sm:table-cell">Items</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customer.sales.map((sale) => {
                      const balance = toNum(sale.total) - toNum(sale.paidAmount);
                      return (
                        <TableRow key={sale.id}>
                          <TableCell>
                            <Link href={`/sales/${sale.id}`} className="font-medium hover:underline">
                              {sale.invoiceNumber}
                            </Link>
                            <p className="text-xs text-muted-foreground">{formatDateTime(sale.createdAt)}</p>
                          </TableCell>
                          <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                            {sale._count.items}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                sale.status === 'COMPLETED'
                                  ? 'success'
                                  : sale.status === 'RETURNED'
                                    ? 'destructive'
                                    : 'warning'
                              }
                            >
                              {humanizeEnum(sale.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="tabular font-medium">
                              {formatCurrency(toNum(sale.total), currency)}
                            </span>
                            {balance > 0 && (
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

          {customer.returns.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Returns</CardTitle>
                <CardDescription>Goods this customer has brought back.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Return</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Refunded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customer.returns.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Link href={`/returns/${item.id}`} className="font-medium hover:underline">
                            {item.returnNumber}
                          </Link>
                          <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.reason ?? '—'}</TableCell>
                        <TableCell className="tabular text-right font-medium">
                          {formatCurrency(toNum(item.total), currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {customer.phone && (
                <p className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a href={`tel:${customer.phone}`} className="hover:underline">
                    {customer.phone}
                  </a>
                </p>
              )}
              {customer.email && (
                <p className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a href={`mailto:${customer.email}`} className="truncate hover:underline">
                    {customer.email}
                  </a>
                </p>
              )}
              {customer.address && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">{customer.address}</span>
                </p>
              )}
              {customer.taxNumber && (
                <p className="text-muted-foreground">Tax number: {customer.taxNumber}</p>
              )}
              {!customer.phone && !customer.email && !customer.address && (
                <p className="text-muted-foreground">No contact details recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Value</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Profit generated">{formatCurrency(profit, currency)}</Row>
              <Row label="Total paid">{formatCurrency(totalPaid, currency)}</Row>
              <Row label="Returns">{customer.returns.length}</Row>
              <Row label="Added">{formatDate(customer.createdAt)}</Row>
            </CardContent>
          </Card>

          {customer.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{customer.notes}</p>
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
