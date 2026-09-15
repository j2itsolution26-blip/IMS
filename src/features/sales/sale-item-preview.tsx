import Link from 'next/link';
import { ProductImage } from '@/components/product-image';
import { formatCurrency, formatQuantity } from '@/lib/format';

/**
 * What was sold, shown on the invoice row itself.
 *
 * A sari-sari owner scanning the sales list wants to see the item, not just an
 * invoice number — so the first line is shown in full and the rest are
 * summarised as a count that leads into the invoice.
 */
export function SaleItemPreview({
  href,
  item,
  extraCount,
  currency,
}: {
  href: string;
  item: { name: string; imageUrl: string | null; quantity: number; unitPrice: number } | null;
  extraCount: number;
  currency: string;
}) {
  if (!item) return <span className="text-sm text-muted-foreground">—</span>;

  return (
    <Link
      href={href}
      className="-mx-1 flex items-center gap-3 rounded-md px-1 py-0.5 transition-colors hover:bg-accent/40"
    >
      <ProductImage src={item.imageUrl} alt={item.name} size="sm" className="h-11 w-11 rounded-lg" />
      {/* Bounded so a long product name truncates instead of stretching the
          column and pushing the total off a phone screen. */}
      <div className="min-w-0 max-w-[11rem] sm:max-w-[18rem]">
        <p className="flex items-center gap-1.5">
          {/* min-w-0 lets the name shrink so the "+N more" badge is never
              squeezed out of the row. */}
          <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
          {extraCount > 0 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary">
              +{extraCount} more
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">Qty: {formatQuantity(item.quantity)}</p>
        <p className="tabular text-xs text-muted-foreground">{formatCurrency(item.unitPrice, currency)}</p>
      </div>
    </Link>
  );
}
