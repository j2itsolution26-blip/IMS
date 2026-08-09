import Link from 'next/link';
import { Package } from 'lucide-react';
import type { ProductPerformance } from '@/server/analytics/dashboard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { EmptyState } from '@/components/empty-state';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Best sellers, worst sellers, and the most profitable lines.
 *
 * "Worst" deliberately includes products that sold nothing at all — the
 * question an owner is asking is "what isn't moving", and a list that only
 * ranks things that did sell cannot answer it.
 */
export function ProductLeaderboard({
  best,
  worst,
  mostProfitable,
  currency,
}: {
  best: ProductPerformance[];
  worst: ProductPerformance[];
  mostProfitable: ProductPerformance[];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Product performance</CardTitle>
        <CardDescription>Ranked from sale lines recorded in the selected period.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="best">
          <TabsList>
            <TabsTrigger value="best">Fast moving</TabsTrigger>
            <TabsTrigger value="profit">Most profitable</TabsTrigger>
            <TabsTrigger value="worst">Slow moving</TabsTrigger>
          </TabsList>

          <TabsContent value="best">
            <PerformanceList rows={best} currency={currency} metric="units" />
          </TabsContent>
          <TabsContent value="profit">
            <PerformanceList rows={mostProfitable} currency={currency} metric="profit" />
          </TabsContent>
          <TabsContent value="worst">
            <PerformanceList rows={worst} currency={currency} metric="units" ascending />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function PerformanceList({
  rows,
  currency,
  metric,
  ascending = false,
}: {
  rows: ProductPerformance[];
  currency: string;
  metric: 'units' | 'profit';
  ascending?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No sales in this period"
        description="Complete a sale in the POS or record one manually, and product rankings will appear here."
        className="py-8"
      />
    );
  }

  // Bars are relative to the top row so the comparison is visible at a glance.
  const peak = Math.max(...rows.map((r) => (metric === 'profit' ? Math.abs(r.profit) : r.unitsSold)), 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row, index) => {
        const value = metric === 'profit' ? row.profit : row.unitsSold;
        const width = Math.max(2, (Math.abs(value) / peak) * 100);

        return (
          <li key={row.productId}>
            <Link href={`/products/${row.productId}`} className="group block rounded-md p-1.5 -m-1.5 hover:bg-accent/50">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:underline">
                  <span className="mr-1.5 text-xs text-muted-foreground">{index + 1}.</span>
                  {row.name}
                </span>
                <span className="tabular shrink-0 text-sm font-medium">
                  {metric === 'profit' ? formatCurrency(row.profit, currency) : formatQuantity(row.unitsSold)}
                </span>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      ascending ? 'bg-chart-4' : metric === 'profit' ? 'bg-chart-3' : 'bg-chart-1',
                    )}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {formatCurrency(row.revenue, currency)} · {row.marginPercent.toFixed(0)}% margin
                </span>
              </div>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.sku} · {row.categoryName} · {formatQuantity(row.currentStock)} in stock
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
