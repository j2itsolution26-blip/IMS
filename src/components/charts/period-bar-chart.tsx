'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { formatCompactCurrency, formatCurrency, formatNumber } from '@/lib/format';
import { AXIS_PROPS, ChartFrame, ChartTooltip, GRID_PROPS } from '@/components/charts/chart-shell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { bucketPhases } from '@/lib/bucket-phases';

export interface PeriodBar {
  /** Bucket start as an ISO timestamp, as the analytics series returns it. */
  bucket: string;
  label: string;
  revenue: number;
  orders: number;
}

const BAR_FILL = 'hsl(var(--primary))';

/**
 * Revenue per bucket across a period: completed buckets hatched, the bucket
 * that contains "now" solid, and buckets still to come left empty — never a
 * placeholder height, which would read as a forecast.
 *
 * The average line covers elapsed buckets only, so an unfinished month is not
 * dragged down by days that have not happened yet.
 */
export function PeriodBarChart({
  data,
  currency,
  now,
  periodLabel = 'Period',
  height = 280,
}: {
  data: PeriodBar[];
  currency: string;
  /** The server's "now" (ISO), so the current bucket matches the figures. */
  now: string;
  /** Heading of the first table column, e.g. "Hour" or "Day". */
  periodLabel?: string;
  height?: number;
}) {
  // Only characters a url(#…) reference accepts, whatever useId's format.
  const hatchId = `hatch-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [showTable, setShowTable] = React.useState(false);

  const { phases, currentIndex } = bucketPhases(
    data.map((point) => point.bucket),
    new Date(now),
  );
  const elapsed = phases.filter((phase) => phase !== 'future').length;

  // Completed buckets only, so a half-finished hour or day does not drag it down.
  const completed = data.filter((_, index) => phases[index] === 'past');
  const average =
    completed.length >= 2 ? completed.reduce((sum, point) => sum + point.revenue, 0) / completed.length : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {currentIndex !== -1 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary" />
              {data[currentIndex].label} (in progress)
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full border border-primary/50"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, hsl(var(--primary) / 0.55) 0 1.5px, transparent 1.5px 4px)',
              }}
            />
            {currentIndex !== -1 ? 'Earlier' : 'Sales'}
          </li>
          {average != null && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-3 border-t border-dashed border-muted-foreground" />
              Average {formatCurrency(average, currency)}
            </li>
          )}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShowTable((value) => !value)}
          aria-expanded={showTable}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {showTable ? (
        <div className="max-h-[300px] overflow-y-auto scrollbar-thin rounded-xl border">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>{periodLabel}</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.slice(0, Math.max(elapsed, 1)).map((point) => (
                <TableRow key={point.bucket}>
                  <TableCell className="font-medium">{point.label}</TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(point.revenue, currency)}</TableCell>
                  <TableCell className="tabular text-right">{formatNumber(point.orders, 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ChartFrame isEmpty={data.length === 0} height={height} emptyMessage="Sales recorded in this period will appear here.">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
            <defs>
              <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={BAR_FILL} fillOpacity={0.1} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={BAR_FILL} strokeOpacity={0.55} strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={16} />
            <YAxis {...AXIS_PROPS} width={64} tickFormatter={(value: number) => formatCompactCurrency(value, currency)} />
            <Tooltip
              cursor={{ fill: 'var(--chart-grid)', opacity: 0.35 }}
              content={(props: TooltipProps<number, string>) => {
                if (!props.active || !props.payload?.length) return null;
                const point = props.payload[0]?.payload as PeriodBar;
                return (
                  <ChartTooltip
                    label={point.label}
                    rows={[
                      { name: 'Revenue', value: formatCurrency(point.revenue, currency) },
                      { name: 'Orders', value: formatNumber(point.orders, 0) },
                    ]}
                  />
                );
              }}
            />
            {average != null && (
              <ReferenceLine y={average} stroke="var(--chart-label)" strokeDasharray="4 4" ifOverflow="extendDomain" />
            )}
            <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 6, 6]} maxBarSize={32} isAnimationActive={false}>
              {data.map((point, index) => {
                const phase = phases[index];
                return (
                  <Cell
                    key={point.bucket}
                    fill={phase === 'current' ? BAR_FILL : phase === 'past' ? `url(#${hatchId})` : 'transparent'}
                    stroke={phase === 'past' ? BAR_FILL : 'none'}
                    strokeOpacity={0.45}
                    strokeWidth={phase === 'past' ? 1 : 0}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ChartFrame>
      )}
    </div>
  );
}
