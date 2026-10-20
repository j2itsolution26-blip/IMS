'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, ScanBarcode, Search } from 'lucide-react';
import type { SellableProduct } from '@/features/products/queries';
import { lookupBarcode, lookupProducts } from '@/features/pos/actions';
import { ScannerDialog } from '@/features/scanner/scanner-dialog';
import { primeAudio } from '@/features/scanner/scanner-panel';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import { formatPieces } from '@/lib/quantity';
import { cn } from '@/lib/utils';
import { PosEntryButton } from '@/features/dashboard/pos-entry-button';

type Lookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; term: string; products: SellableProduct[] };

const MAX_RESULTS = 6;

/**
 * The cashier's way into the till, and a price-and-stock check on the way.
 *
 * Search and scan go through the POS's own lookups (`pos.view`, checked on
 * the server), so they return exactly what the till would ring up. Nothing
 * here changes stock or starts a sale — that happens at the POS.
 */
export function PosQuickAccess({
  currency,
  hasOpenShift,
  suggestedOpeningCash,
}: {
  currency: string;
  hasOpenShift: boolean;
  suggestedOpeningCash: number;
}) {
  const [term, setTerm] = React.useState('');
  const [lookup, setLookup] = React.useState<Lookup>({ status: 'idle' });
  const [scanning, setScanning] = React.useState(false);
  const latest = React.useRef(0);

  React.useEffect(() => {
    const value = term.trim();
    if (value.length < 2) {
      setLookup({ status: 'idle' });
      return;
    }
    const request = ++latest.current;
    setLookup({ status: 'loading' });
    const timer = setTimeout(async () => {
      const result = await lookupProducts(value);
      // A slower, older request must not overwrite a newer answer.
      if (request !== latest.current) return;
      setLookup(
        result.ok
          ? { status: 'done', term: value, products: result.data.slice(0, MAX_RESULTS) }
          : { status: 'error', message: result.error },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  const posHref = term.trim() ? `/pos?q=${encodeURIComponent(term.trim())}` : '/pos';

  return (
    <section
      aria-labelledby="pos-quick-access"
      className="mb-4 rounded-xl border bg-card p-4 shadow-2xs sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="pos-quick-access" className="text-base font-semibold">
            Point of Sale
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ring up a sale, or check a price and stock before the customer reaches the counter.
          </p>
        </div>
        <PosEntryButton
          hasOpenShift={hasOpenShift}
          suggestedAmount={suggestedOpeningCash}
          currency={currency}
          className="w-full sm:w-auto"
        />
      </div>

      <form
        role="search"
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setTerm((current) => current.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            inputMode="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search name, SKU or barcode"
            aria-label="Search products by name, SKU or barcode"
            className="h-11 pl-9"
            maxLength={80}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 px-3 sm:px-4"
          onClick={() => {
            primeAudio();
            setScanning(true);
          }}
        >
          <ScanBarcode /> <span className="hidden sm:inline">Scan</span>
          <span className="sr-only sm:hidden">Scan a barcode</span>
        </Button>
      </form>

      <ScannerDialog
        open={scanning}
        onOpenChange={setScanning}
        title="Check a product"
        description="Scan a barcode to see the product's price and stock. Nothing is added to a sale."
        mode="single"
        manualEntry
        onBarcodeDetected={async (code) => {
          const result = await lookupBarcode(code);
          if (!result.ok) return { tone: 'error', title: result.error };
          const found = result.data;
          if (found.status === 'not-found') return { tone: 'error', title: 'No product has this barcode' };
          if (found.status === 'unavailable') return { tone: 'warning', title: `${found.name} is not for sale` };
          // The stored spelling, so the search below matches it exactly.
          setTerm(found.product.barcode ?? found.product.sku);
          return { tone: 'success', title: found.product.name };
        }}
      />

      <LookupResults lookup={lookup} currency={currency} posHref={posHref} />
    </section>
  );
}

function LookupResults({ lookup, currency, posHref }: { lookup: Lookup; currency: string; posHref: string }) {
  if (lookup.status === 'idle') return null;

  if (lookup.status === 'loading') {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
      </p>
    );
  }

  if (lookup.status === 'error') {
    return (
      <p className="mt-3 text-sm text-destructive" role="alert">
        {lookup.message}
      </p>
    );
  }

  if (lookup.products.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        Nothing matches “{lookup.term}”.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <ul className="divide-y rounded-lg border" aria-label="Matching products">
        {lookup.products.map((product) => (
          <li key={product.id} className="flex items-center gap-3 px-3 py-2.5">
            <ProductImage src={product.imageUrl} alt={product.name} size="sm" className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{product.name}</p>
              <p className="truncate text-xs text-muted-foreground">{product.barcode ?? product.sku}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="tabular text-sm font-semibold">{formatCurrency(product.sellingPrice, currency)}</p>
              <Availability product={product} />
            </div>
          </li>
        ))}
      </ul>
      <Link
        href={posHref}
        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline"
      >
        Continue in POS <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function Availability({ product }: { product: SellableProduct }) {
  if (!product.isTrackable) return <p className="text-xs text-muted-foreground">Not stock-tracked</p>;
  const out = product.available <= 0;
  return (
    <p className={cn('tabular text-xs font-medium', out ? 'text-destructive' : 'text-success')}>
      {out ? 'Out of stock' : `${formatPieces(product.available)} in stock`}
    </p>
  );
}
