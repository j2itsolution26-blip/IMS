'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { formatCompactCurrency, formatCurrency, formatNumber } from '@/lib/format';
import {
  AXIS_PROPS,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  GRID_PROPS,
  SERIES,
} from '@/components/charts/chart-shell';

export interface ColumnDatum {
  label: string;
  value: number;
  /** Optional second measure drawn beside the first, e.g. profit against revenue. */
  secondary?: number;
}

/**
 * Vertical bars over a time axis — months across a year, hours across a day.
 *
 * The horizontal `BreakdownChart` is the right form for ranked names; this is
 * the right form when the axis is time and the order is fixed.
 */
export function ColumnChart({
  data,
  currency,
  valueLabel,
  secondaryLabel,
  height = 220,
  emptyMessage,
  /** Counts rather than money, e.g. transactions per hour. */
  asCount = false,
}: {
  data: ColumnDatum[];
  currency: string;
  valueLabel: string;
  secondaryLabel?: string;
  height?: number;
  emptyMessage: string;
  asCount?: boolean;
}) {
  const hasSecondary = data.some((point) => point.secondary != null);
  const isEmpty = data.every((point) => point.value === 0 && !point.secondary);

  const show = (value: number) => (asCount ? formatNumber(value, 0) : formatCurrency(value, currency));

  const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    return (
      <ChartTooltip
        label={String(label)}
        rows={payload.map((entry) => ({
          name: entry.name === 'secondary' ? (secondaryLabel ?? 'Secondary') : valueLabel,
          value: show(Number(entry.value ?? 0)),
          color: entry.color,
        }))}
      />
    );
  };

  return (
    <div className="space-y-3">
      {hasSecondary && secondaryLabel && (
        <ChartLegend
          items={[
            { label: valueLabel, color: SERIES[0] },
            { label: secondaryLabel, color: SERIES[2] },
          ]}
        />
      )}

      <ChartFrame isEmpty={isEmpty} emptyMessage={emptyMessage} height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" />
          <YAxis
            {...AXIS_PROPS}
            width={56}
            tickFormatter={(value: number) =>
              asCount ? formatNumber(value, 0) : formatCompactCurrency(value, currency)
            }
          />
          <Tooltip content={renderTooltip} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
          <Bar dataKey="value" name={valueLabel} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={38} />
          {hasSecondary && (
            <Bar dataKey="secondary" name="secondary" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={38} />
          )}
        </BarChart>
      </ChartFrame>
    </div>
  );
}
