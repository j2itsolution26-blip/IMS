'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Package, Search, ShoppingCart } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';

interface SearchHit {
  id: string;
  type: 'product' | 'sale';
  title: string;
  subtitle: string;
  href: string;
  meta?: number;
}

const ICONS = {
  product: Package,
  sale: ShoppingCart,
} as const;

/**
 * Cross-entity search. Hits come from `/api/search`, which queries products,
 * partners, and documents — there is no client-side index to go stale.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K focuses search from anywhere.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    // Debounced so typing does not fire a query per keystroke.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Search failed');
        const data = (await response.json()) as { results: SearchHit[] };
        setHits(data.results);
        setHighlighted(0);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQuery('');
    router.push(hit.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open || hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[highlighted];
      if (hit) go(hit);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search products or invoices…"
        className="pl-8 pr-10"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-autocomplete="list"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {!loading && (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">
          ⌘K
        </kbd>
      )}

      {open && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto scrollbar-thin rounded-md border bg-popover p-1 shadow-lg"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches for “{query.trim()}”.
            </p>
          ) : (
            hits.map((hit, index) => {
              const Icon = ICONS[hit.type];
              return (
                <button
                  key={`${hit.type}-${hit.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => go(hit)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm',
                    index === highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{hit.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                  </span>
                  {hit.meta != null && (
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {formatCurrency(hit.meta)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
