'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { formatNumber } from '@/lib/format';
import { formatPieces } from '@/lib/quantity';
import { AXIS_PROPS, ChartFrame, ChartLegend, ChartTooltip, GRID_PROPS, SERIES } from '@/components/charts/chart-shell';
import { truncate } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Stock status donut                                                         */
/* -------------------------------------------------------------------------- */

/** Status colours are reserved for state, and always ship with a label and a count. */
const STATUS_COLOR = {
  IN: 'hsl(var(--success))',
  LOW: 'hsl(var(--warning))',
  OUT: 'hsl(var(--destructive))',
} as const;

export interface StatusSlice {
  key: 'IN' | 'LOW' | 'OUT';
  label: string;
  value: number;
  href: string;
}

export function StockStatusDonut({ data }: { data: StatusSlice[] }) {
  const router = useRouter();
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const visible = data.filter((slice) => slice.value > 0);

  const renderTooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const slice = payload[0].payload as StatusSlice;
    return (
      <ChartTooltip
        label={slice.label}
        rows={[
          { name: 'Products', value: formatNumber(slice.value, 0), color: STATUS_COLOR[slice.key] },
          { name: 'Share', value: total > 0 ? `${formatNumber((slice.value / total) * 100, 0)}%` : '—' },
        ]}
      />
    );
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-center">
      <div className="relative w-full max-w-[200px] shrink-0">
        <ChartFrame isEmpty={total === 0} emptyMessage="Add products to see their stock status." height={190}>
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="92%"
              paddingAngle={visible.length > 1 ? 2 : 0}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(slice: StatusSlice) => router.push(slice.href)}
              className="cursor-pointer"
            >
              {visible.map((slice) => (
                <Cell key={slice.key} fill={STATUS_COLOR[slice.key]} />
              ))}
            </Pie>
            <Tooltip content={renderTooltip} />
          </PieChart>
        </ChartFrame>
        {total > 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-2xl font-bold leading-none">{formatNumber(total, 0)}</span>
            <span className="mt-1 text-[11px] text-muted-foreground">products</span>
          </div>
        )}
      </div>

      {/* The legend doubles as the table view: label, count and share, each a link. */}
      <ul className="w-full space-y-1.5">
        {data.map((slice) => (
          <li key={slice.key}>
            <a
              href={slice.href}
              onClick={(event) => {
                event.preventDefault();
                router.push(slice.href);
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[slice.key] }} />
              <span className="flex-1">{slice.label}</span>
              <span className="tabular font-semibold">{formatNumber(slice.value, 0)}</span>
              <span className="tabular w-10 text-right text-xs text-muted-foreground">
                {total > 0 ? `${formatNumber((slice.value / total) * 100, 0)}%` : '—'}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Products by category                                                       */
/* -------------------------------------------------------------------------- */

export interface CategoryBar {
  categoryId: string;
  name: string;
  products: number;
}

/**
 * Horizontal ranked bars — category names need horizontal room. One measure,
 * one hue. Clicking a bar (or its row in the table) opens that category in
 * the inventory register.
 */
export function CategoryBarChart({ data }: { data: CategoryBar[] }) {
  const router = useRouter();
  const open = (categoryId: string) => router.push(`/inventory?category=${encodeURIComponent(categoryId)}`);
  const height = Math.max(160, data.length * 36 + 24);
  const isEmpty = data.length === 0 || data.every((row) => row.products === 0);

  const renderTooltip = ({ active, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as CategoryBar;
    return (
      <ChartTooltip
        label={row.name}
        rows={[{ name: 'Active products', value: formatNumber(row.products, 0), color: SERIES[0] }]}
      />
    );
  };

  return (
    <div className="p-4">
      <ChartFrame isEmpty={isEmpty} emptyMessage="Products appear here once they are assigned to a category." height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
          <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            {...AXIS_PROPS}
            tickFormatter={(value: string) => truncate(value, 16)}
          />
          <Tooltip content={renderTooltip} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
          <Bar
            dataKey="products"
            fill={SERIES[0]}
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(row: CategoryBar) => open(row.categoryId)}
          >
            <LabelList dataKey="products" position="right" className="fill-foreground text-xs tabular-nums" />
          </Bar>
        </BarChart>
      </ChartFrame>

      <table className="sr-only">
        <caption>Active products by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Products</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.categoryId}>
              <td>
                <a href={`/inventory?category=${encodeURIComponent(row.categoryId)}`}>{row.name}</a>
              </td>
              <td>{row.products}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stock movement trend                                                       */
/* -------------------------------------------------------------------------- */

export interface MovementBar {
  label: string;
  received: number;
  adjusted: number;
}

const MOVEMENT_SERIES = [
  { key: 'received', label: 'Pieces received', color: SERIES[0] },
  { key: 'adjusted', label: 'Net adjustment', color: SERIES[1] },
] as const;

/**
 * Pieces received and net adjustments per day. Both are piece counts, so they
 * share one axis; adjustments can be negative, so the zero line is drawn.
 */
export function MovementTrendChart({ data, hasHistory }: { data: MovementBar[]; hasHistory: boolean }) {
  const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as MovementBar;
    return (
      <ChartTooltip
        label={String(label)}
        rows={[
          { name: 'Received', value: formatPieces(row.received), color: SERIES[0] },
          {
            name: 'Adjusted',
            value: `${row.adjusted > 0 ? '+' : ''}${formatPieces(row.adjusted)}`,
            color: SERIES[1],
          },
        ]}
      />
    );
  };

  return (
    <div className="space-y-3 p-4">
      {hasHistory && <ChartLegend items={MOVEMENT_SERIES.map(({ label, color }) => ({ label, color }))} />}
      <ChartFrame
        isEmpty={!hasHistory}
        emptyMessage="No stock was received or adjusted in the last seven days."
        height={220}
      >
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis allowDecimals={false} {...AXIS_PROPS} />
          <ReferenceLine y={0} stroke="var(--chart-axis)" />
          <Tooltip content={renderTooltip} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
          {MOVEMENT_SERIES.map((series) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              fill={series.color}
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartFrame>

      <table className="sr-only">
        <caption>Stock movements over the last seven days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Pieces received</th>
            <th scope="col">Net adjustment</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.received}</td>
              <td>{row.adjusted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
