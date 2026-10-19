'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ScanLine, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { lookupInventoryBarcode } from '@/features/inventory/actions';
import { ScannerDialog } from '@/features/scanner/scanner-dialog';
import { primeAudio, type ScanFeedback } from '@/features/scanner/scanner-panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface StockTab {
  value: string;
  label: string;
  count: number;
}

/**
 * The register's toolbar: which slice of stock to look at, and how to find one
 * product inside it.
 *
 * Every control writes to the URL so the server does the filtering, the view
 * survives a refresh, and a link can be shared or bookmarked.
 */
export function InventorySearchFilter({
  tabs,
  categories,
}: {
  tabs: StockTab[];
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const currentSearch = searchParams.get('q') ?? '';
  const currentStatus = searchParams.get('status') ?? 'ALL';
  const currentCategory = searchParams.get('category') ?? 'ALL';
  const currentSort = searchParams.get('sort') ?? 'stock';

  const [term, setTerm] = React.useState(currentSearch);
  React.useEffect(() => setTerm(currentSearch), [currentSearch]);

  const push = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      // Any change to the slice invalidates the page cursor.
      params.delete('page');
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  // Debounced so a query is not issued on every keystroke.
  React.useEffect(() => {
    if (term === currentSearch) return;
    const timer = setTimeout(() => {
      push((params) => {
        if (term.trim()) params.set('q', term.trim());
        else params.delete('q');
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [term, currentSearch, push]);

  const [scanning, setScanning] = React.useState(false);

  /**
   * Finds the product behind a scanned code and shows its row. The search is
   * set to the barcode *as stored*, so a code scanned without the spacing
   * printed on the pack still lands on it, and the slice filters are cleared
   * so a "Low" tab can't hide the product just found. Inactive and non-stock
   * products aren't in the register at all, so those open the product page.
   */
  const onBarcodeDetected = async (code: string): Promise<ScanFeedback> => {
    const result = await lookupInventoryBarcode(code);
    if (!result.ok) return { tone: 'error', title: result.error };
    if (result.data.status === 'not-found') return { tone: 'error', title: 'No product has this barcode' };

    const { product } = result.data;
    if (product.productStatus !== 'ACTIVE' || !product.isTrackable) {
      startTransition(() => router.push(`/products/${product.id}`));
      return {
        tone: 'success',
        title: product.name,
        meta: product.productStatus !== 'ACTIVE' ? product.productStatus.toLowerCase() : 'no stock count',
      };
    }

    const search = product.barcode ?? product.sku;
    setTerm(search);
    push((params) => {
      params.set('q', search);
      params.delete('status');
      params.delete('category');
    });
    return { tone: 'success', title: product.name, meta: `${formatQuantity(product.onHand)} ${product.unit}` };
  };

  const setParam = (name: string, value: string, fallback: string) =>
    push((params) => {
      if (value === fallback) params.delete(name);
      else params.set(name, value);
    });

  return (
    <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
      {/* Segmented slices. Counts come from the same snapshot the cards use,
          so a tab can never promise a number the table does not list. */}
      <div
        role="tablist"
        aria-label="Filter by stock level"
        // Tabs share the width evenly on a phone and only scroll — inside the
        // control, never the page — on the very narrowest screens.
        className="flex w-full min-w-0 shrink-0 gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg bg-muted p-1 scrollbar-none sm:gap-1 lg:w-auto"
      >
        {tabs.map((tab) => {
          const active = currentStatus === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={pending}
              onClick={() => setParam('status', tab.value, 'ALL')}
              className={cn(
                'flex min-h-9 flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors sm:gap-1.5 sm:px-3 sm:text-sm lg:flex-none',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span className={cn('tabular text-xs', active ? 'text-muted-foreground' : 'opacity-70')}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 gap-2 sm:flex-1 lg:flex-none">
          <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search name, SKU or scan barcode"
              className="h-11 pl-9 sm:h-10"
              aria-label="Search products"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
            onClick={() => {
              primeAudio();
              setScanning(true);
            }}
            aria-label="Scan a barcode to find a product"
            title="Scan barcode"
          >
            <ScanLine />
          </Button>
          <ScannerDialog
            open={scanning}
            onOpenChange={setScanning}
            title="Find by barcode"
            description="Scan a product's barcode to show it in the stock list."
            mode="single"
            manualEntry
            onBarcodeDetected={onBarcodeDetected}
          />
        </div>

        <div className="flex min-w-0 gap-2">
          <Select
            value={currentCategory}
            disabled={pending}
            onValueChange={(value) => setParam('category', value, 'ALL')}
          >
            <SelectTrigger className="h-11 w-full min-w-0 sm:h-10 sm:w-[170px]" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Category: All</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={currentSort}
            disabled={pending}
            onValueChange={(value) => setParam('sort', value, 'stock')}
          >
            <SelectTrigger className="h-11 w-full min-w-0 sm:h-10 sm:w-[170px]" aria-label="Sort products">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stock">Sort: Stock level</SelectItem>
              <SelectItem value="name">Sort: Name</SelectItem>
              <SelectItem value="price">Sort: Price</SelectItem>
              <SelectItem value="value">Sort: Stock value</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
