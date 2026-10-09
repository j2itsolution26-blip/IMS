import Link from 'next/link';
import { LineChart } from 'lucide-react';
import type { DashboardOverview } from '@/server/analytics/dashboard-overview';
import { TrendChart } from '@/components/charts/trend-chart';
import { Button } from '@/components/ui/button';
import { Panel, PanelEmpty } from '@/features/dashboard/overview-panels';
import { formatCurrency, formatNumber } from '@/lib/format';

/**
 * Revenue and profit over the selected window.
 *
 * The three figures above the chart are the same numbers the KPI row shows,
 * repeated here so the chart can be read without looking away from it.
 */
export function SalesPerformancePanel({
  trend,
  summary,
  currency,
  className,
}: {
  trend: DashboardOverview['trend'];
  summary: DashboardOverview['summary']['current'];
  currency: string;
  className?: string;
}) {
  const hasSales = trend.some((point) => point.revenue > 0 || point.orders > 0);

  return (
    <Panel title="Sales performance" description="Revenue and profit trends." className={className}>
      {!hasSales ? (
        <PanelEmpty
          icon={LineChart}
          title="No sales yet"
          description="Complete your first sale to start seeing revenue trends here."
          action={
            <Button asChild size="sm">
              <Link href="/pos">Open POS</Link>
            </Button>
          }
        />
      ) : (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Figure label="Revenue" value={formatCurrency(summary.revenue, currency)} />
            <Figure label="Profit" value={formatCurrency(summary.netProfit, currency)} />
            <Figure label="Transactions" value={formatNumber(summary.transactionCount, 0)} />
          </div>

          <TrendChart
            currency={currency}
            height={230}
            data={trend.map((point) => ({
              label: point.label,
              revenue: point.revenue,
              profit: point.profit,
              orders: point.orders,
            }))}
          />
        </div>
      )}
    </Panel>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 truncate text-base font-bold">{value}</p>
    </div>
  );
}
