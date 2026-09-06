'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * The search box is deliberately the largest control on the page, and the
 * only filter is the one distinction an owner actually cares about: is
 * anything running low. Everything else lives behind the search box.
 */
export function InventorySearchFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const currentSearch = searchParams.get('q') ?? '';
  const currentStatus = searchParams.get('status') ?? 'ALL';
  const [term, setTerm] = React.useState(currentSearch);

  React.useEffect(() => setTerm(currentSearch), [currentSearch]);

  const push = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete('page');
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

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

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search product name or barcode…"
          className="h-12 pl-11 text-base sm:h-11"
          aria-label="Search products"
        />
      </div>

      <Select
        value={currentStatus}
        disabled={pending}
        onValueChange={(next) =>
          push((params) => {
            if (next === 'ALL') params.delete('status');
            else params.set('status', next);
          })
        }
      >
        <SelectTrigger className="h-12 w-full sm:h-11 sm:w-[190px]" aria-label="Filter products">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Products</SelectItem>
          <SelectItem value="LOW">Low Stock</SelectItem>
          <SelectItem value="OUT_OF_STOCK">Out of Stock</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
