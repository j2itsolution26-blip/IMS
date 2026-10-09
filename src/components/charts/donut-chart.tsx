'use client';

import * as React from 'react';
import { Cell, Pie, PieChart, Tooltip, type TooltipProps } from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/format';
import { ChartFrame, ChartTooltip, SERIES } from '@/components/charts/chart-shell';

export interface DonutSlice {
  label: string;
  value: number;
  /** Shown under the amount, e.g. the number of transactions. */
  count?: number;
  share: number;
}

/**
 * Share-of-total, with the total itself in the hole.
 *
 * A donut only works for a handful of slices, which is the case here — a till
 * records a couple of payment methods, not twenty.
 */
export function DonutChart({
  data,
  currency,
  centerLabel,
  height = 200,
  emptyMessage,
}: {
  data: DonutSlice[];
  currency: string;
  centerLabel: string;
  height?: number;
  emptyMessage: string;
}) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  const renderTooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const slice = payload[0].payload as DonutSlice & { fill: string };
    return (
      <ChartTooltip
        label={slice.label}
        rows={[
          { name: 'Amount', value: formatCurrency(slice.value, currency), color: slice.fill },
          { name: 'Share', value: `${formatNumber(slice.share, 1)}%` },
          ...(slice.count != null
            ? [{ name: 'Payments', value: formatNumber(slice.count, 0) }]
            : []),
        ]}
      />
    );
  };

  return (
    <div className="relative">
      <ChartFrame isEmpty={data.length === 0} emptyMessage={emptyMessage} height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={data.length > 1 ? 2 : 0}
            strokeWidth={0}
          >
            {data.map((slice, index) => (
              <Cell key={slice.label} fill={SERIES[index % SERIES.length]} />
            ))}
          </Pie>
          <Tooltip content={renderTooltip} />
        </PieChart>
      </ChartFrame>

      {data.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-xl font-bold leading-none">
            {formatCurrency(total, currency)}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">{centerLabel}</span>
        </div>
      )}
    </div>
  );
}
