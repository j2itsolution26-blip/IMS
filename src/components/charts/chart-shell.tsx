'use client';

import * as React from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Shared chart chrome.
 *
 * The palette's light-mode steps for aqua, yellow, and magenta sit below 3:1
 * against the surface, so the relief the palette requires — a legend plus a
 * table view — is provided here rather than being left to each chart.
 */

export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

/** Axis/grid styling shared by every chart so they read as one system. */
export const AXIS_PROPS = {
  stroke: 'var(--chart-axis)',
  tick: { fill: 'var(--chart-label)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const GRID_PROPS = {
  stroke: 'var(--chart-grid)',
  strokeDasharray: '0',
  vertical: false,
} as const;

export function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium text-muted-foreground">No data yet</p>
      <p className="max-w-xs text-xs text-muted-foreground/80">{message}</p>
    </div>
  );
}

/**
 * Wraps a chart in a fixed-height responsive container, or shows an honest
 * empty state. A chart with no rows renders nothing rather than an axis
 * suggesting there is something to see.
 */
export function ChartFrame({
  isEmpty,
  emptyMessage,
  height = 280,
  className,
  children,
}: {
  isEmpty: boolean;
  emptyMessage: string;
  height?: number;
  className?: string;
  children: React.ReactElement;
}) {
  if (isEmpty) {
    return (
      <div style={{ height }} className={className}>
        <ChartEmpty message={emptyMessage} />
      </div>
    );
  }

  return (
    <div style={{ height }} className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export interface TooltipRow {
  name: string;
  value: string;
  color?: string;
}

/** Tooltip surface. Values wear text tokens; the swatch carries series identity. */
export function ChartTooltip({ label, rows }: { label: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-foreground">{label}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-2">
            {row.color && (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
            )}
            <span className="text-muted-foreground">{row.name}</span>
            <span className="tabular ml-auto font-medium text-foreground">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Identity must never be colour alone: this legend pairs each swatch with its
 * label, and is rendered whenever a chart carries two or more series.
 */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
