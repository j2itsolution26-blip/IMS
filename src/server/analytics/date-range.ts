import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from 'date-fns';

/**
 * Period arithmetic shared by every analytics query.
 *
 * Each range carries the equivalent previous period so any figure can be shown
 * with a real like-for-like comparison instead of an invented trend.
 */

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'last7' | 'last30' | 'last90' | 'all';

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
  /** Same-length window immediately before `from`, for period-over-period deltas. */
  previous: { from: Date; to: Date };
}

const WEEK_OPTIONS = { weekStartsOn: 1 } as const; // ISO weeks — Monday start.

export function resolveRange(period: PeriodKey, now: Date = new Date()): DateRange {
  switch (period) {
    case 'today': {
      const from = startOfDay(now);
      const to = endOfDay(now);
      return {
        from,
        to,
        label: 'Today',
        previous: { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) },
      };
    }
    case 'yesterday': {
      const day = subDays(now, 1);
      return {
        from: startOfDay(day),
        to: endOfDay(day),
        label: 'Yesterday',
        previous: { from: startOfDay(subDays(now, 2)), to: endOfDay(subDays(now, 2)) },
      };
    }
    case 'week': {
      const from = startOfWeek(now, WEEK_OPTIONS);
      return {
        from,
        to: endOfWeek(now, WEEK_OPTIONS),
        label: 'This week',
        previous: {
          from: startOfWeek(subDays(from, 1), WEEK_OPTIONS),
          to: endOfWeek(subDays(from, 1), WEEK_OPTIONS),
        },
      };
    }
    case 'month': {
      const from = startOfMonth(now);
      const prev = subMonths(now, 1);
      return {
        from,
        to: endOfMonth(now),
        label: 'This month',
        previous: { from: startOfMonth(prev), to: endOfMonth(prev) },
      };
    }
    case 'quarter': {
      const from = startOfMonth(subMonths(now, 2));
      return {
        from,
        to: endOfDay(now),
        label: 'Last 3 months',
        previous: { from: startOfMonth(subMonths(now, 5)), to: endOfMonth(subMonths(now, 3)) },
      };
    }
    case 'year': {
      const from = startOfYear(now);
      const prev = subYears(now, 1);
      return {
        from,
        to: endOfYear(now),
        label: 'This year',
        previous: { from: startOfYear(prev), to: endOfYear(prev) },
      };
    }
    case 'last7':
      return buildTrailing(now, 7, 'Last 7 days');
    case 'last30':
      return buildTrailing(now, 30, 'Last 30 days');
    case 'last90':
      return buildTrailing(now, 90, 'Last 90 days');
    case 'all':
    default: {
      const from = new Date(2000, 0, 1);
      return { from, to: endOfDay(now), label: 'All time', previous: { from, to: from } };
    }
  }
}

function buildTrailing(now: Date, days: number, label: string): DateRange {
  const to = endOfDay(now);
  const from = startOfDay(subDays(now, days - 1));
  return {
    from,
    to,
    label,
    previous: {
      from: startOfDay(subDays(from, days)),
      to: endOfDay(subDays(from, 1)),
    },
  };
}

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

export function isPeriodKey(value: string | undefined): value is PeriodKey {
  return PERIOD_OPTIONS.some((o) => o.value === value) || value === 'quarter';
}

/** Parses a `?period=` search param, defaulting safely. */
export function parsePeriod(value: string | undefined, fallback: PeriodKey = 'last30'): PeriodKey {
  return isPeriodKey(value) ? value : fallback;
}
