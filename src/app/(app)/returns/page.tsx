import type { Metadata } from 'next';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatCurrency, formatDateTime } from '@/lib/format';
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
      reason: true,
      total: true,
      restock: true,
      createdAt: true,
      sale: { select: { id: true, invoiceNumber: true } },
      user: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  const refundTotal = returns.reduce((acc, item) => acc + toNum(item.total), 0);

  return (
    <>
      <PageHeader
        title="Returns"
        description={`Refunds processed ${range.label.toLowerCase()}. Every refund is tied to its original sale.`}
        actions={<PeriodPicker current={period} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Refunded</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(refundTotal, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total refunds</p>
          <p className="mt-1 text-xl font-semibold">{returns.length}</p>
        </Card>
      </div>

      <div className="rounded-lg border">
        {returns.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title="No refunds in this period"
            description="Open a sale and choose “Record return” to refund and put sellable goods back into stock."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return</TableHead>
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
                    <Link href={`/returns/${item.id}`} className="font-medium hover:underline">
                      {item.returnNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)} · {item._count.items} line
                      {item._count.items === 1 ? '' : 's'} · by {item.user.name}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {item.sale ? (
                      <Link href={`/sales/${item.sale.id}`} className="hover:underline">
                        {item.sale.invoiceNumber}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="line-clamp-1 text-sm text-muted-foreground">{item.reason ?? '—'}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.restock ? 'success' : 'destructive'}>
                      {item.restock ? 'Yes' : 'Written off'}
                    </Badge>
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
