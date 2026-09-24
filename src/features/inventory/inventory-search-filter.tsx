'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
        className="flex w-full shrink-0 gap-1 overflow-x-auto rounded-lg bg-muted p-1 lg:w-auto"
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
                'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search name, SKU or scan barcode"
            className="h-10 pl-9"
            aria-label="Search products"
          />
        </div>

        <div className="flex gap-2">
          <Select
            value={currentCategory}
            disabled={pending}
            onValueChange={(value) => setParam('category', value, 'ALL')}
          >
            <SelectTrigger className="h-10 w-full sm:w-[170px]" aria-label="Filter by category">
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
            <SelectTrigger className="h-10 w-full sm:w-[170px]" aria-label="Sort products">
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
