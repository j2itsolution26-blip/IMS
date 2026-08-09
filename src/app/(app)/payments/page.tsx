import type { Metadata } from 'next';
import Link from 'next/link';
import { Coins } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { getPaymentMethodBreakdown } from '@/server/analytics/sales-analytics';
import { formatCurrency, formatDateTime, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Payments' };
export const dynamic = 'force-dynamic';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePermission('payments.view');
  const params = await searchParams;

  const period = parsePeriod(params.period, 'last30');
  const range = resolveRange(period);
  const currency = await getCurrency();

  const [payments, byMethod] = await Promise.all([
    prisma.payment.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        paymentNumber: true,
        direction: true,
        method: true,
        amount: true,
        reference: true,
        note: true,
        createdAt: true,
        sale: { select: { id: true, invoiceNumber: true } },
        purchaseOrder: { select: { id: true, orderNumber: true } },
        return: { select: { id: true, returnNumber: true } },
        user: { select: { name: true } },
      },
    }),
    getPaymentMethodBreakdown(range.from, range.to),
  ]);

  const inbound = payments
    .filter((p) => p.direction === 'INBOUND')
    .reduce((acc, p) => acc + toNum(p.amount), 0);
  const outbound = payments
    .filter((p) => p.direction === 'OUTBOUND')
    .reduce((acc, p) => acc + toNum(p.amount), 0);

  return (
    <>
      <PageHeader
        title="Payments"
        description={`Money in and out for ${range.label.toLowerCase()}, recorded against sales, purchase orders, and refunds.`}
        actions={<PeriodPicker current={period} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Received</p>
          <p className="mt-1 text-xl font-semibold text-success">{formatCurrency(inbound, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paid out</p>
          <p className="mt-1 text-xl font-semibold text-destructive">{formatCurrency(outbound, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net movement</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(inbound - outbound, currency)}</p>
        </Card>
      </div>

      {byMethod.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Takings by method</CardTitle>
            <CardDescription>Incoming payments only — what actually hit each rail.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {byMethod.map((method) => (
                <li key={method.method} className="flex items-center justify-between gap-2 rounded-md border p-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{humanizeEnum(method.method)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {method.count} payment{method.count === 1 ? '' : 's'} · {method.share.toFixed(1)}%
                    </span>
                  </span>
                  <span className="tabular shrink-0 font-semibold">
                    {formatCurrency(method.amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="rounded-lg border">
        {payments.length === 0 ? (
          <EmptyState
            icon={Coins}
            title="No payments in this period"
            description="Payments are created automatically when you complete a sale, refund a return, or pay a supplier."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="hidden md:table-cell">Against</TableHead>
                <TableHead className="hidden lg:table-cell">Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => {
                const inboundRow = payment.direction === 'INBOUND';
                return (
                  <TableRow key={payment.id}>
                    <TableCell>
                      <p className="font-medium">{payment.paymentNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(payment.createdAt)} · {payment.user.name}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={inboundRow ? 'success' : 'secondary'}>
                        {humanizeEnum(payment.method)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {payment.sale ? (
                        <Link href={`/sales/${payment.sale.id}`} className="hover:underline">
                          {payment.sale.invoiceNumber}
                        </Link>
                      ) : payment.purchaseOrder ? (
                        <Link href={`/purchases/${payment.purchaseOrder.id}`} className="hover:underline">
                          {payment.purchaseOrder.orderNumber}
                        </Link>
                      ) : payment.return ? (
                        <span className="text-muted-foreground">{payment.return.returnNumber}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {payment.reference ?? payment.note ?? '—'}
                    </TableCell>
                    <TableCell
                      className={`tabular text-right font-medium ${
                        inboundRow ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {inboundRow ? '+' : '−'} {formatCurrency(toNum(payment.amount), currency)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
