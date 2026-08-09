'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface FilterSelect {
  name: string;
  label: string;
  /** The option shown when the filter is off, e.g. "All categories". */
  allLabel: string;
  options: { value: string; label: string }[];
  width?: string;
}

/**
 * URL-driven filter bar for server-paginated lists.
 *
 * Filter state lives in the query string rather than component state so the
 * server does the filtering, the view is shareable, and the back button works.
 */
export function FilterBar({
  searchPlaceholder = 'Search…',
  selects = [],
  showSearch = true,
  children,
}: {
  searchPlaceholder?: string;
  selects?: FilterSelect[];
  showSearch?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const currentSearch = searchParams.get('q') ?? '';
  const [term, setTerm] = React.useState(currentSearch);

  // Keep the box in sync when navigation changes the URL (back button, reset).
  React.useEffect(() => setTerm(currentSearch), [currentSearch]);

  const push = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      // Any filter change invalidates the current page cursor.
      params.delete('page');
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  // Debounce so a query is not issued on every keystroke.
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

  const activeCount =
    (currentSearch ? 1 : 0) + selects.filter((select) => searchParams.get(select.name)).length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {showSearch && (
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label={searchPlaceholder}
          />
        </div>
      )}

      {selects.map((select) => {
        const value = searchParams.get(select.name) ?? 'ALL';
        return (
          <Select
            key={select.name}
            value={value}
            disabled={pending}
            onValueChange={(next) =>
              push((params) => {
                if (next === 'ALL') params.delete(select.name);
                else params.set(select.name, next);
              })
            }
          >
            <SelectTrigger className={select.width ?? 'w-[170px]'} aria-label={select.label}>
              <SelectValue placeholder={select.allLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{select.allLabel}</SelectItem>
              {select.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}

      {children}

      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => startTransition(() => router.push(pathname))}
          disabled={pending}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}

/** Page links for a server-paginated list. */
export function PaginationBar({
  page,
  pageCount,
  total,
}: {
  page: number;
  pageCount: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const goTo = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(next));
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {total === 0
          ? 'No rows'
          : `Page ${page} of ${pageCount} · ${total.toLocaleString()} row${total === 1 ? '' : 's'}`}
      </p>
      {pageCount > 1 && (
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => goTo(page - 1)} disabled={page <= 1 || pending}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goTo(page + 1)}
            disabled={page >= pageCount || pending}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
