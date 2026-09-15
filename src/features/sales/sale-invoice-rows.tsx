import Link from 'next/link';
import type { SaleListRow } from '@/features/sales/queries';
import { ProductImage } from '@/components/product-image';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDateTime, formatQuantity, humanizeEnum } from '@/lib/format';
import { SALE_STATUS_BADGE, SALE_STATUS_LABEL } from '@/lib/sale-status';
import { cn } from '@/lib/utils';

/**
 * One invoice, rendered as one row per product sold.
 *
 * The invoice's own facts — number, cashier, payment, total, status — are
 * written once and spanned down the group rather than repeated on each line,
 * so the total can never be mistaken for an item's price and the rows read as
 * belonging to a single sale.
 */

/** Row rhythm: the shared TableCell is tighter, and other pages depend on that. */
const CELL = 'px-4 py-3';

export function SaleInvoiceRows({ sale, currency }: { sale: SaleListRow; currency: string }) {
  // A sale with no lines still gets one row, so it never silently disappears.
  const lines: (SaleListRow['items'][number] | null)[] = sale.items.length > 0 ? sale.items : [null];
  const span = lines.length;

  // A spanned cell hugs the top so it sits beside the first line of a
  // multi-item invoice. With a single line there is nothing to span, and
  // top-aligning it there just leaves it floating above its own row.
  const ALIGN = span > 1 ? 'align-top' : 'align-middle';

  return (
    <>
      {lines.map((item, index) => (
        <TableRow
          key={item?.id ?? sale.id}
          className={cn(
            // Inner dividers are dropped so one invoice reads as a single
            // block, with a line only where the next invoice starts.
            index < span - 1 && 'border-b-0',
            span > 1 && 'bg-muted/20',
          )}
        >
          {index === 0 && (
            <TableCell rowSpan={span} className={cn(CELL, ALIGN)}>
              <Link
                href={`/sales/${sale.id}`}
                className="whitespace-nowrap text-sm font-semibold tracking-tight hover:underline"
              >
                {sale.invoiceNumber}
              </Link>
              <p className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
                {formatDateTime(sale.createdAt)}
              </p>
              {span > 1 && (
                <p className="whitespace-nowrap text-xs text-muted-foreground">{span} items</p>
              )}
            </TableCell>
          )}

          <TableCell className={CELL}>
            {item ? (
              <div className="flex items-center gap-3">
                <ProductImage
                  src={item.imageUrl}
                  alt={item.name}
                  size="sm"
                  className="h-11 w-11 shrink-0 rounded-lg"
                />
                <span className="min-w-0 max-w-[16rem] truncate text-sm font-medium text-foreground">
                  {item.name}
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No items recorded</span>
            )}
          </TableCell>

          <TableCell className={cn(CELL, 'tabular whitespace-nowrap text-right text-sm')}>
            {item ? formatQuantity(item.quantity) : '—'}
          </TableCell>
          <TableCell
            className={cn(CELL, 'tabular whitespace-nowrap text-right text-sm text-muted-foreground')}
          >
            {item ? formatCurrency(item.unitPrice, currency) : '—'}
          </TableCell>
          <TableCell className={cn(CELL, 'tabular whitespace-nowrap text-right text-sm')}>
            {item ? formatCurrency(item.lineTotal, currency) : '—'}
          </TableCell>

          {index === 0 && (
            <>
              <TableCell rowSpan={span} className={cn(CELL, ALIGN, 'text-sm text-foreground')}>
                {sale.cashierName}
              </TableCell>
              <TableCell rowSpan={span} className={cn(CELL, ALIGN)}>
                {sale.paymentMethod ? (
                  <span className="inline-flex items-center whitespace-nowrap rounded-md border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground">
                    {humanizeEnum(sale.paymentMethod)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell rowSpan={span} className={cn(CELL, ALIGN, 'text-right')}>
                <span className="tabular whitespace-nowrap text-sm font-semibold tracking-tight">
                  {formatCurrency(sale.total, currency)}
                </span>
              </TableCell>
              <TableCell rowSpan={span} className={cn(CELL, ALIGN)}>
                <Badge
                  variant={SALE_STATUS_BADGE[sale.status]}
                  className="px-2.5 py-0.5 text-[11px] font-semibold"
                >
                  {SALE_STATUS_LABEL[sale.status]}
                </Badge>
              </TableCell>
            </>
          )}
        </TableRow>
      ))}
    </>
  );
}
