'use client';

import * as React from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { StockPickerProduct } from '@/features/inventory/queries';
import { Input } from '@/components/ui/input';
import { formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Type-ahead product picker shared by the adjustment and transfer forms.
 *
 * The full active-product list is loaded once and filtered locally — these
 * screens are used with a known list in hand, so a round trip per keystroke
 * would only slow the operator down.
 */
export function ProductPicker({
  products,
  exclude,
  onSelect,
  placeholder = 'Search a product to add…',
}: {
  products: StockPickerProduct[];
  exclude: Set<string>;
  onSelect: (product: StockPickerProduct) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const matches = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    return products
      .filter((product) => !exclude.has(product.id))
      .filter(
        (product) =>
          !needle ||
          product.name.toLowerCase().includes(needle) ||
          product.sku.toLowerCase().includes(needle),
      )
      .slice(0, 30);
  }, [products, exclude, term]);

  const choose = (product: StockPickerProduct) => {
    onSelect(product);
    setTerm('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (matches.length > 0) choose(matches[0]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="pl-8 pr-8"
        aria-label={placeholder}
        aria-expanded={open}
      />
      {term && (
        <button
          type="button"
          onClick={() => setTerm('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto scrollbar-thin rounded-md border bg-popover p-1 shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {products.length === 0
                ? 'No trackable products exist yet.'
                : term
                  ? `Nothing matches “${term}”.`
                  : 'Every product is already on this list.'}
            </p>
          ) : (
            matches.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => choose(product)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm',
                  'hover:bg-accent focus:bg-accent focus:outline-none',
                )}
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{product.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{product.sku}</span>
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {formatQuantity(product.onHand)} {product.unit}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Shared "nothing added yet" prompt for the line editors. */
export function EmptyLines({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
