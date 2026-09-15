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
export function SaleInvoiceRows({ sale, currency }: { sale: SaleListRow; currency: string }) {
  // A sale with no lines still gets one row, so it never silently disappears.
  const lines: (SaleListRow['items'][number] | null)[] = sale.items.length > 0 ? sale.items : [null];
  const span = lines.length;

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
            <TableCell rowSpan={span} className="align-top">
              <Link
                href={`/sales/${sale.id}`}
                className="whitespace-nowrap font-medium hover:underline"
              >
                {sale.invoiceNumber}
              </Link>
              {/* The timestamp is the first thing to go on a phone — the
                  per-item figures earn that width. */}
              <p className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">
                {formatDateTime(sale.createdAt)}
              </p>
              {span > 1 && (
                <p className="whitespace-nowrap text-xs text-muted-foreground">{span} items</p>
              )}
            </TableCell>
          )}

          <TableCell>
            {item ? (
              <div className="flex items-center gap-3">
                <ProductImage
                  src={item.imageUrl}
                  alt={item.name}
                  size="sm"
                  className="h-11 w-11 rounded-lg"
                />
                <span className="min-w-0 max-w-[7rem] truncate text-sm font-medium sm:max-w-[18rem]">
                  {item.name}
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No items recorded</span>
            )}
          </TableCell>

          <TableCell className="tabular whitespace-nowrap text-right text-sm">
            {item ? formatQuantity(item.quantity) : '—'}
          </TableCell>
          <TableCell className="tabular hidden whitespace-nowrap text-right text-sm text-muted-foreground sm:table-cell">
            {item ? formatCurrency(item.unitPrice, currency) : '—'}
          </TableCell>
          <TableCell className="tabular whitespace-nowrap text-right text-sm">
            {item ? formatCurrency(item.lineTotal, currency) : '—'}
          </TableCell>

          {index === 0 && (
            <>
              <TableCell
                rowSpan={span}
                className="hidden align-top text-sm text-muted-foreground lg:table-cell"
              >
                {sale.cashierName}
              </TableCell>
              <TableCell
                rowSpan={span}
                className="hidden align-top text-sm text-muted-foreground md:table-cell"
              >
                {sale.paymentMethod ? humanizeEnum(sale.paymentMethod) : '—'}
              </TableCell>
              <TableCell rowSpan={span} className="align-top text-right">
                <span className="tabular whitespace-nowrap font-semibold">
                  {formatCurrency(sale.total, currency)}
                </span>
              </TableCell>
              <TableCell rowSpan={span} className="align-top">
                <Badge variant={SALE_STATUS_BADGE[sale.status]}>{SALE_STATUS_LABEL[sale.status]}</Badge>
              </TableCell>
            </>
          )}
        </TableRow>
      ))}
    </>
  );
}
