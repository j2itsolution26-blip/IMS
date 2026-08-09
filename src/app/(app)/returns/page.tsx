import type { Metadata } from 'next';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatCurrency, formatDateTime, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Returns' };
export const dynamic = 'force-dynamic';

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePermission('returns.view');
  const params = await searchParams;

  const period = parsePeriod(params.period, 'last30');
  const range = resolveRange(period);
  const currency = await getCurrency();

  const returns = await prisma.return.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      returnNumber: true,
      type: true,
      status: true,
      reason: true,
      total: true,
      restock: true,
      createdAt: true,
      sale: { select: { id: true, invoiceNumber: true } },
      customer: { select: { id: true, name: true } },
      user: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  const saleReturns = returns.filter((item) => item.type === 'SALE_RETURN');
  const refundTotal = saleReturns.reduce((acc, item) => acc + toNum(item.total), 0);
  const supplierReturnTotal = returns
    .filter((item) => item.type === 'PURCHASE_RETURN')
    .reduce((acc, item) => acc + toNum(item.total), 0);

  return (
    <>
      <PageHeader
        title="Returns"
        description={`Goods returned ${range.label.toLowerCase()}. Sale returns are raised from the sale itself; purchase returns send stock back to a supplier.`}
        actions={<PeriodPicker current={period} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer refunds</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(refundTotal, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Returned to suppliers</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(supplierReturnTotal, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total returns</p>
          <p className="mt-1 text-xl font-semibold">{returns.length}</p>
        </Card>
      </div>

      <div className="rounded-lg border">
        {returns.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title="No returns in this period"
            description="Open a sale and choose “Record return” to refund a customer and put sellable goods back into stock."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Against</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead>Restocked</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="font-medium">{item.returnNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)} · {item._count.items} line
                      {item._count.items === 1 ? '' : 's'} · {item.user.name}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.type === 'SALE_RETURN' ? 'warning' : 'secondary'}>
                      {item.type === 'SALE_RETURN' ? 'Customer' : 'Supplier'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {item.sale ? (
                      <Link href={`/sales/${item.sale.id}`} className="hover:underline">
                        {item.sale.invoiceNumber}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {item.customer && (
                      <p className="text-xs text-muted-foreground">{item.customer.name}</p>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="line-clamp-1 text-sm text-muted-foreground">{item.reason ?? '—'}</span>
                  </TableCell>
                  <TableCell>
                    {item.type === 'SALE_RETURN' ? (
                      <Badge variant={item.restock ? 'success' : 'destructive'}>
                        {item.restock ? 'Yes' : 'Written off'}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{humanizeEnum(item.status)}</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatCurrency(toNum(item.total), currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
