'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import {
  AXIS_PROPS,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  GRID_PROPS,
  SERIES,
} from '@/components/charts/chart-shell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

export interface TrendPoint {
  label: string;
  revenue: number;
  profit: number;
  orders: number;
}

/**
 * Revenue and profit over time.
 *
 * Both series share one y-axis on purpose — profit is a component of revenue,
 * so a second scale would exaggerate movement that isn't there.
 */
export function TrendChart({
  data,
  currency,
  height = 300,
}: {
  data: TrendPoint[];
  currency: string;
  height?: number;
}) {
  const [showTable, setShowTable] = React.useState(false);

  const legend = [
    { label: 'Revenue', color: SERIES[0] },
    { label: 'Profit', color: SERIES[2] },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChartLegend items={legend} />
        {data.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
          >
            {showTable ? 'Show chart' : 'Show table'}
          </Button>
        )}
      </div>

      {showTable ? (
        <div className="max-h-[300px] overflow-y-auto scrollbar-thin rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((point) => (
                <TableRow key={point.label}>
                  <TableCell className="font-medium">{point.label}</TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(point.revenue, currency)}</TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(point.profit, currency)}</TableCell>
                  <TableCell className="tabular text-right">{point.orders}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ChartFrame
          isEmpty={data.length === 0}
          height={height}
          emptyMessage="Sales recorded in this period will appear here."
        >
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.22} />
                <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES[2]} stopOpacity={0.2} />
                <stop offset="100%" stopColor={SERIES[2]} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={24} />
            <YAxis
              {...AXIS_PROPS}
              width={64}
              tickFormatter={(value: number) => formatCompactCurrency(value, currency)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
              content={(props: TooltipProps<number, string>) => {
                if (!props.active || !props.payload?.length) return null;
                const point = props.payload[0]?.payload as TrendPoint;
                return (
                  <ChartTooltip
                    label={point.label}
                    rows={[
                      { name: 'Revenue', value: formatCurrency(point.revenue, currency), color: SERIES[0] },
                      { name: 'Profit', value: formatCurrency(point.profit, currency), color: SERIES[2] },
                      { name: 'Orders', value: String(point.orders) },
                    ]}
                  />
                );
              }}
            />

            <Area
              type="monotone"
              dataKey="revenue"
              stroke={SERIES[0]}
              strokeWidth={2}
              fill="url(#revenueFill)"
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
            />
            <Area
              type="monotone"
              dataKey="profit"
              stroke={SERIES[2]}
              strokeWidth={2}
              fill="url(#profitFill)"
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
            />
          </AreaChart>
        </ChartFrame>
      )}
    </div>
  );
}
