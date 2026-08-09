import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, FileBarChart } from 'lucide-react';
import type { InventoryTransactionType } from '@prisma/client';
import { requirePermission } from '@/lib/session';
import { listMovements, listActiveWarehouses } from '@/features/inventory/queries';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatCurrency, formatDateTime, formatQuantity, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Stock movements' };
export const dynamic = 'force-dynamic';

const TYPES: InventoryTransactionType[] = [
  'PURCHASE_RECEIPT',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'OPENING_BALANCE',
];

/** Where a movement's source document lives, when there is one to link to. */
function referenceHref(referenceType: string | null, referenceId: string | null): string | null {
  if (!referenceType || !referenceId) return null;
  if (referenceType === 'SALE') return `/sales/${referenceId}`;
  if (referenceType === 'PURCHASE_ORDER') return `/purchases/${referenceId}`;
  if (referenceType === 'RETURN') return `/returns/${referenceId}`;
  // Adjustments and transfers reference a generated document number, not a row id.
  return null;
}

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; warehouse?: string; period?: string; page?: string }>;
}) {
  await requirePermission('inventory.view');
  const params = await searchParams;

  const period = parsePeriod(params.period, 'last30');
  const range = resolveRange(period);

  const [warehouses, currency] = await Promise.all([listActiveWarehouses(), getCurrency()]);

  const result = await listMovements({
    search: params.q,
    type: TYPES.includes(params.type as InventoryTransactionType)
      ? (params.type as InventoryTransactionType)
      : 'ALL',
    warehouseId: params.warehouse,
    from: range.from,
    to: range.to,
    page: Number(params.page) || 1,
  });

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="The complete stock ledger. Every sale, receipt, adjustment, and transfer, with the running balance."
        breadcrumbs={[{ label: 'Stock levels', href: '/inventory' }, { label: 'Movements' }]}
        actions={<PeriodPicker current={period} />}
      />

      <FilterBar
        searchPlaceholder="Search product name or SKU…"
        selects={[
          {
            name: 'type',
            label: 'Movement type',
            allLabel: 'All types',
            width: 'w-[190px]',
            options: TYPES.map((type) => ({ value: type, label: humanizeEnum(type) })),
          },
          {
            name: 'warehouse',
            label: 'Warehouse',
            allLabel: 'All warehouses',
            options: warehouses.map((w) => ({ value: w.id, label: w.name })),
          },
        ]}
      />

      <div className="rounded-lg border">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title="No movements in this period"
            description="Receiving stock, selling at the POS, adjusting, and transferring all write entries to this ledger."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                  <TableHead className="hidden lg:table-cell">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((movement) => {
                  const inbound = movement.quantity > 0;
                  const href = referenceHref(movement.referenceType, movement.referenceId);

                  return (
                    <TableRow key={movement.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(movement.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/products/${movement.productId}`} className="font-medium hover:underline">
                          {movement.productName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{movement.sku}</p>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                          {inbound ? (
                            <ArrowDownLeft className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                          ) : (
                            <ArrowUpRight className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                          )}
                          {href ? (
                            <Link href={href} className="hover:underline">
                              {humanizeEnum(movement.type)}
                            </Link>
                          ) : (
                            humanizeEnum(movement.type)
                          )}
                        </span>
                        {movement.note && (
                          <span className="line-clamp-1 text-xs text-muted-foreground">{movement.note}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {movement.warehouseName}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'tabular text-right font-medium',
                          inbound ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {inbound ? '+' : ''}
                        {formatQuantity(movement.quantity)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        <span className="text-muted-foreground">{formatQuantity(movement.balanceBefore)}</span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="font-medium">{formatQuantity(movement.balanceAfter)}</span>
                      </TableCell>
                      <TableCell className="tabular hidden text-right text-sm text-muted-foreground lg:table-cell">
                        {formatCurrency(movement.value, currency)}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {movement.userName}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
