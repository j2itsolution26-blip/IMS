import Link from 'next/link';
import type { InventorySnapshot } from '@/server/analytics/dashboard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatNumber } from '@/lib/format';

/**
 * Stock composition by health band.
 *
 * A stacked meter rather than a pie: the question is "how much of my catalogue
 * is in trouble", which is a part-to-whole comparison along one bar. Each band
 * is directly labelled, so the colours are never the only cue.
 */
export function StockHealthCard({
  snapshot,
  currency,
}: {
  snapshot: InventorySnapshot;
  currency: string;
}) {
  const bands = [
    { key: 'OUT_OF_STOCK', label: 'Out of stock', count: snapshot.outOfStock, className: 'bg-destructive', href: '/inventory?status=OUT_OF_STOCK' },
    { key: 'CRITICAL', label: 'Critical', count: snapshot.criticalStock, className: 'bg-warning', href: '/inventory?status=CRITICAL' },
    { key: 'LOW', label: 'Low', count: snapshot.lowStock, className: 'bg-chart-4', href: '/inventory?status=LOW' },
    { key: 'HEALTHY', label: 'Healthy', count: snapshot.healthyStock, className: 'bg-success', href: '/inventory?status=HEALTHY' },
    { key: 'OVERSTOCK', label: 'Overstocked', count: snapshot.overStock, className: 'bg-chart-1', href: '/inventory?status=OVERSTOCK' },
  ];

  const total = bands.reduce((acc, band) => acc + band.count, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Stock health</CardTitle>
        <CardDescription>
          {total > 0
            ? `${formatNumber(total, 0)} active products, valued at ${formatCurrency(snapshot.costValue, currency)}.`
            : 'No active products yet.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Add products and record stock to see the health breakdown.
          </p>
        ) : (
          <>
            {/* 2px surface gaps keep adjacent segments legible without borders. */}
            <div
              className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={bands.map((b) => `${b.label}: ${b.count}`).join(', ')}
            >
              {bands
                .filter((band) => band.count > 0)
                .map((band) => (
                  <span
                    key={band.key}
                    className={band.className}
                    style={{ width: `${(band.count / total) * 100}%` }}
                  />
                ))}
            </div>

            <ul className="space-y-1.5">
              {bands.map((band) => (
                <li key={band.key}>
                  <Link
                    href={band.href}
                    className="flex items-center gap-2 rounded-md py-0.5 text-sm transition-colors hover:text-primary"
                  >
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${band.className}`} />
                    <span className="flex-1 text-muted-foreground">{band.label}</span>
                    <span className="tabular font-medium">{formatNumber(band.count, 0)}</span>
                    <span className="tabular w-11 text-right text-xs text-muted-foreground">
                      {total > 0 ? `${((band.count / total) * 100).toFixed(0)}%` : '—'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {snapshot.deadStock > 0 && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                {snapshot.deadStock} product{snapshot.deadStock === 1 ? '' : 's'} holding stock with no recent
                sales.{' '}
                <Link href="/reports/dead-stock" className="font-medium underline">
                  Review dead stock
                </Link>
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
