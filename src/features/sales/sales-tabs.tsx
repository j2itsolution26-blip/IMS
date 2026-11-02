import Link from 'next/link';
import { cn } from '@/lib/utils';

export type SalesTab = 'sales' | 'cash' | 'gcash';

const TABS: { key: SalesTab; label: string; href: string }[] = [
  { key: 'sales', label: 'Sales', href: '/sales' },
  { key: 'cash', label: 'Cash in / out', href: '/cash-movements' },
  { key: 'gcash', label: 'GCash services', href: '/gcash-services' },
];

/**
 * Sales, drawer cash in / out and GCash services as one area. Each tab is its
 * own page over the same records the shift drawer reads, so nothing is
 * listed or counted twice: GCash services and cash movements never appear in
 * sales revenue, and each shows in the drawer breakdown once.
 */
export function SalesTabs({ current }: { current: SalesTab }) {
  return (
    <nav aria-label="Sales and cash" className="mb-5 flex gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? 'page' : undefined}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tab.key === current ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
