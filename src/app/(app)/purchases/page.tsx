import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Truck } from 'lucide-react';
import type { PurchaseOrderStatus } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { listPurchaseOrders } from '@/features/purchases/queries';
import { detectSupplierDelays } from '@/server/services/purchase-service';
import { prisma } from '@/lib/prisma';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatCurrency, formatDate, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/misc';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Purchases' };
export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  DRAFT: 'secondary',
  ORDERED: 'default',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
};

const STATUSES: PurchaseOrderStatus[] = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; supplier?: string; period?: string; page?: string }>;
}) {
  const user = await requirePermission('purchases.view');
  const params = await searchParams;

  // Refresh late-delivery alerts whenever this screen is opened.
  void detectSupplierDelays().catch(() => undefined);

  const period = parsePeriod(params.period, 'last90');
  const range = resolveRange(period);

  const [suppliers, currency] = await Promise.all([
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getCurrency(),
  ]);

  const result = await listPurchaseOrders({
    search: params.q,
    status: STATUSES.includes(params.status as PurchaseOrderStatus)
      ? (params.status as PurchaseOrderStatus)
      : 'ALL',
    supplierId: params.supplier,
    from: range.from,
    to: range.to,
    page: Number(params.page) || 1,
  });

  return (
    <>
      <PageHeader
        title="Purchases"
        description={`Orders raised ${range.label.toLowerCase()}. Stock only changes when an order is received.`}
        actions={
          <>
            <PeriodPicker current={period} />
            {userCan(user, 'purchases.create') && (
              <Button asChild>
                <Link href="/purchases/new">
                  <Plus /> New order
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Committed spend</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(result.summary.committed, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding to pay</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(result.summary.outstanding, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Orders</p>
          <p className="mt-1 text-xl font-semibold">{result.summary.count.toLocaleString()}</p>
        </Card>
      </div>

      <FilterBar
        searchPlaceholder="Search order number or supplier…"
        selects={[
          {
            name: 'status',
            label: 'Status',
            allLabel: 'All statuses',
            width: 'w-[190px]',
            options: STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) })),
          },
          {
            name: 'supplier',
            label: 'Supplier',
            allLabel: 'All suppliers',
            options: suppliers.map((s) => ({ value: s.id, label: s.name })),
          },
        ]}
      />

      <div className="rounded-lg border">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No purchase orders"
            description="Raise an order to record what you've bought, then receive against it to bring stock in and update your average cost."
            action={
              userCan(user, 'purchases.create') && (
                <Button asChild>
                  <Link href="/purchases/new">
                    <Plus /> Create your first order
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead className="hidden md:table-cell">Supplier</TableHead>
                  <TableHead className="hidden lg:table-cell">Expected</TableHead>
                  <TableHead className="w-32">Received</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/purchases/${order.id}`} className="font-medium hover:underline">
                        {order.orderNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(order.createdAt)} · {order.lineCount} line
                        {order.lineCount === 1 ? '' : 's'} · {order.warehouseName}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      <Link href={`/suppliers`} className="hover:underline">
                        {order.supplierName}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {order.expectedDate ? (
                        <span className={order.isLate ? 'font-medium text-warning' : 'text-muted-foreground'}>
                          {formatDate(order.expectedDate)}
                          {order.isLate && <span className="block text-xs">overdue</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Progress
                        value={order.receivedPercent}
                        indicatorClassName={order.receivedPercent === 100 ? 'bg-success' : 'bg-primary'}
                        aria-label={`${order.receivedPercent}% received`}
                      />
                      <span className="tabular mt-1 block text-xs text-muted-foreground">
                        {order.receivedPercent}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="tabular font-medium">{formatCurrency(order.total, currency)}</span>
                      {order.balance > 0 && order.status !== 'CANCELLED' && (
                        <span className="tabular block text-xs text-warning">
                          {formatCurrency(order.balance, currency)} unpaid
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[order.status]}>{humanizeEnum(order.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
