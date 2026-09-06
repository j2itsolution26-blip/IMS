'use client';

import * as React from 'react';
import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { checkBarcodeAction } from '@/features/products/actions';
import { formatCurrency, formatQuantity } from '@/lib/format';

/**
 * Warns as soon as a barcode (typed or scanned) already belongs to another
 * product — before the owner finds out the hard way at save time, when the
 * database's unique constraint on `barcode` would reject it anyway.
 */
export function BarcodeDuplicateNotice({
  barcode,
  currency,
  excludeId,
}: {
  barcode: string;
  currency: string;
  excludeId?: string;
}) {
  const [match, setMatch] = React.useState<{ id: string; name: string; sellingPrice: number; onHand: number } | null>(
    null,
  );

  React.useEffect(() => {
    const trimmed = barcode.trim();
    if (!trimmed) {
      setMatch(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await checkBarcodeAction(trimmed, excludeId);
      if (!cancelled && result.ok) setMatch(result.data);
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [barcode, excludeId]);

  if (!match) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-warning">Product already exists</p>
        <p className="truncate text-sm font-medium">{match.name}</p>
        <p className="tabular text-xs text-muted-foreground">
          {formatCurrency(match.sellingPrice, currency)} · Stock: {formatQuantity(match.onHand)}
        </p>
      </div>
      <Link
        href={`/products/${match.id}`}
        className="shrink-0 whitespace-nowrap text-sm font-medium text-primary hover:underline"
      >
        View Product
      </Link>
    </div>
  );
}
