import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDateTime, formatQuantity, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const record = await prisma.return.findUnique({ where: { id }, select: { returnNumber: true } });
  return { title: record?.returnNumber ?? 'Return' };
}

/**
 * Refund detail: what came back, what was refunded, who processed it and
 * when, and whether it went back into sellable stock.
 */
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('returns.view');
  const { id } = await params;

  const [record, currency] = await Promise.all([
    prisma.return.findUnique({
      where: { id },
      include: {
        sale: { select: { id: true, invoiceNumber: true, createdAt: true } },
        user: { select: { name: true } },
        payments: { orderBy: { createdAt: 'asc' } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, unit: { select: { abbreviation: true } } },
            },
          },
        },
      },
    }),
    getCurrency(),
  ]);

  if (!record) notFound();

  return (
    <>
      <PageHeader
        title={record.returnNumber}
        description={`Recorded ${formatDateTime(record.createdAt)} by ${record.user.name}`}
        breadcrumbs={[{ label: 'Returns', href: '/returns' }, { label: record.returnNumber }]}
        actions={
          <Badge
            variant={
              record.status === 'COMPLETED' ? 'success' : record.status === 'REJECTED' ? 'destructive' : 'warning'
            }
          >
            {humanizeEnum(record.status)}
          </Badge>
        }
      />

      {!record.restock && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            These goods were <strong>not</strong> returned to sellable stock — the sale was refunded and the
            items written off.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Returned items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/products/${item.product.id}`} className="font-medium hover:underline">
                        {item.product.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{item.product.sku}</p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatQuantity(toNum(item.quantity))} {item.product.unit.abbreviation}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(toNum(item.unitPrice), currency)}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatCurrency(toNum(item.total), currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">
                    Refunded
                  </TableCell>
                  <TableCell className="tabular text-right text-base font-bold">
                    {formatCurrency(toNum(record.total), currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {record.sale && (
                <Row label="Against sale">
                  <Link href={`/sales/${record.sale.id}`} className="text-primary hover:underline">
                    {record.sale.invoiceNumber}
                  </Link>
                </Row>
              )}
              <Row label="Processed by">{record.user.name}</Row>
              <Row label="When">{formatDateTime(record.createdAt)}</Row>
              <Row label="Lines">{record.items.length}</Row>
              <Row label="Restocked">
                <span className={record.restock ? 'text-success' : 'text-destructive'}>
                  {record.restock ? 'Yes' : 'Written off'}
                </span>
              </Row>
            </CardContent>
          </Card>

          {record.reason && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Reason</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{record.reason}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
                Refund payment
              </CardTitle>
            </CardHeader>
            <CardContent>
              {record.payments.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">No refund recorded.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {record.payments.map((payment) => (
                    <li key={payment.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{humanizeEnum(payment.method)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {payment.paymentNumber} · {formatDateTime(payment.createdAt)}
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-medium">
                        {formatCurrency(toNum(payment.amount), currency)}
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
