'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { formatCompactCurrency, formatCurrency, formatNumber } from '@/lib/format';
import {
  AXIS_PROPS,
  ChartFrame,
  ChartTooltip,
  GRID_PROPS,
  SERIES,
} from '@/components/charts/chart-shell';
import { truncate } from '@/lib/utils';

export interface BreakdownDatum {
  label: string;
  value: number;
  secondary?: number;
  share?: number;
}

/**
 * Horizontal ranked bars — the right form when the labels are names rather
 * than a time axis, because names need horizontal room to stay readable.
 *
 * One measure, one hue: rank is not identity, so the bars do not each take a
 * different categorical colour.
 */
export function BreakdownChart({
  data,
  currency,
  valueLabel = 'Revenue',
  secondaryLabel,
  height = 300,
  colorIndex = 0,
  asCurrency = true,
}: {
  data: BreakdownDatum[];
  currency: string;
  valueLabel?: string;
  secondaryLabel?: string;
  height?: number;
  colorIndex?: number;
  asCurrency?: boolean;
}) {
  const color = SERIES[colorIndex % SERIES.length];
  const format = (value: number) => (asCurrency ? formatCurrency(value, currency) : formatNumber(value));

  return (
    <ChartFrame
      isEmpty={data.length === 0}
      height={height}
      emptyMessage="There are no transactions in this period to break down."
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
        <XAxis
          type="number"
          {...AXIS_PROPS}
          tickFormatter={(value: number) =>
            asCurrency ? formatCompactCurrency(value, currency) : formatNumber(value, 0)
          }
        />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS_PROPS}
          width={120}
          tickFormatter={(value: string) => truncate(value, 18)}
        />
        <Tooltip
          cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }}
          content={(props: TooltipProps<number, string>) => {
            if (!props.active || !props.payload?.length) return null;
            const datum = props.payload[0]?.payload as BreakdownDatum;
            return (
              <ChartTooltip
                label={datum.label}
                rows={[
                  { name: valueLabel, value: format(datum.value), color },
                  ...(secondaryLabel && datum.secondary != null
                    ? [{ name: secondaryLabel, value: formatNumber(datum.secondary) }]
                    : []),
                  ...(datum.share != null ? [{ name: 'Share', value: `${datum.share.toFixed(1)}%` }] : []),
                ]}
              />
            );
          }}
        />
        {/* 4px rounded data-end, square against the baseline. */}
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
          {data.map((datum) => (
            <Cell key={datum.label} fill={color} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/**
 * Vertical bars for an ordered, time-like axis (hour of day, ageing buckets)
 * where the categories have a natural sequence.
 */
export function ColumnChart({
  data,
  currency,
  valueLabel = 'Revenue',
  secondaryLabel,
  height = 260,
  colorIndex = 0,
  asCurrency = true,
}: {
  data: BreakdownDatum[];
  currency: string;
  valueLabel?: string;
  secondaryLabel?: string;
  height?: number;
  colorIndex?: number;
  asCurrency?: boolean;
}) {
  const color = SERIES[colorIndex % SERIES.length];
  const format = (value: number) => (asCurrency ? formatCurrency(value, currency) : formatNumber(value));

  return (
    <ChartFrame
      isEmpty={data.every((d) => d.value === 0)}
      height={height}
      emptyMessage="No activity has been recorded for this period yet."
    >
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" />
        <YAxis
          {...AXIS_PROPS}
          width={56}
          tickFormatter={(value: number) =>
            asCurrency ? formatCompactCurrency(value, currency) : formatNumber(value, 0)
          }
        />
        <Tooltip
          cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }}
          content={(props: TooltipProps<number, string>) => {
            if (!props.active || !props.payload?.length) return null;
            const datum = props.payload[0]?.payload as BreakdownDatum;
            return (
              <ChartTooltip
                label={datum.label}
                rows={[
                  { name: valueLabel, value: format(datum.value), color },
                  ...(secondaryLabel && datum.secondary != null
                    ? [{ name: secondaryLabel, value: formatNumber(datum.secondary, 0) }]
                    : []),
                ]}
              />
            );
          }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={color} maxBarSize={36} />
      </BarChart>
    </ChartFrame>
  );
}
