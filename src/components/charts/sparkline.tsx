'use client';

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

/**
 * The shape of a number over the period, at a glance.
 *
 * Deliberately axis-less and tooltip-less: it is decoration for a figure that
 * is already written out beside it, so it carries no information of its own
 * and is hidden from screen readers.
 */
export function Sparkline({
  data,
  tone = 'primary',
  height = 36,
}: {
  data: number[];
  tone?: 'primary' | 'success' | 'warning';
  height?: number;
}) {
  const id = React.useId();

  // Two points are the minimum that can describe a direction.
  if (data.length < 2) return null;

  const stroke =
    tone === 'success' ? 'hsl(var(--success))' : tone === 'warning' ? 'hsl(var(--warning))' : 'hsl(var(--primary))';

  const points = data.map((value, index) => ({ index, value }));

  return (
    <div style={{ height }} className="w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.75}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
