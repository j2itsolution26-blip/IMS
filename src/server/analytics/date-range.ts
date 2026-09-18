import {
  differenceInCalendarDays,
  endOfDay,
  format,
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

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'lastMonth'
  | 'quarter'
  | 'year'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'all'
  /** Only ever produced by `resolveRangeFromParams`, which carries the dates. */
  | 'custom';

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
  /** Same-length window immediately before `from`, for period-over-period deltas. */
  previous: { from: Date; to: Date };
  /** A user-picked date span, whose label is already written as dates. */
  isCustom: boolean;
}

/**
 * The label as it reads mid-sentence.
 *
 * Named periods lowercase ("today"); a custom span keeps its capitals, since
 * "1 sep 2026" is just wrong.
 */
export function inlineLabel(range: DateRange): string {
  return range.isCustom ? range.label : range.label.toLowerCase();
}

const WEEK_OPTIONS = { weekStartsOn: 1 } as const; // ISO weeks — Monday start.

export function resolveRange(period: PeriodKey, now: Date = new Date()): DateRange {
  return { ...resolveNamedRange(period, now), isCustom: false };
}

type NamedRange = Omit<DateRange, 'isCustom'>;

function resolveNamedRange(period: PeriodKey, now: Date): NamedRange {
  switch (period) {
    case 'today': {
      const from = startOfDay(now);
      const to = endOfDay(now);
      return {
        from,
        to,
        label: 'Today',
        previous: {
          from: startOfDay(subDays(now, 1)),
          to: endOfDay(subDays(now, 1)),
        },
      };
    }
    case 'yesterday': {
      const day = subDays(now, 1);
      return {
        from: startOfDay(day),
        to: endOfDay(day),
        label: 'Yesterday',
        previous: {
          from: startOfDay(subDays(now, 2)),
          to: endOfDay(subDays(now, 2)),
        },
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
    case 'lastMonth': {
      const previousMonth = subMonths(now, 1);
      const monthBefore = subMonths(now, 2);
      return {
        from: startOfMonth(previousMonth),
        to: endOfMonth(previousMonth),
        label: 'Last month',
        previous: {
          from: startOfMonth(monthBefore),
          to: endOfMonth(monthBefore),
        },
      };
    }
    case 'quarter': {
      const from = startOfMonth(subMonths(now, 2));
      return {
        from,
        to: endOfDay(now),
        label: 'Last 3 months',
        previous: {
          from: startOfMonth(subMonths(now, 5)),
          to: endOfMonth(subMonths(now, 3)),
        },
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
    // A custom window needs its dates, which only `resolveRangeFromParams`
    // has; landing here means they were missing or unreadable.
    case 'custom':
      return resolveRange('today', now);
    case 'all':
    default: {
      const from = new Date(2000, 0, 1);
      return {
        from,
        to: endOfDay(now),
        label: 'All time',
        previous: { from, to: from },
      };
    }
  }
}

/** Accepts only the `YYYY-MM-DD` a date input produces. */
function parseDayParam(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildCustomRange(fromValue: string | undefined, toValue: string | undefined): DateRange | null {
  const a = parseDayParam(fromValue);
  const b = parseDayParam(toValue);
  if (!a || !b) return null;

  // Tolerate the dates arriving the wrong way round rather than showing nothing.
  const [start, end] = a <= b ? [a, b] : [b, a];
  const from = startOfDay(start);
  const to = endOfDay(end);
  const days = differenceInCalendarDays(to, from) + 1;

  return {
    from,
    to,
    label: `${format(from, 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`,
    previous: {
      from: startOfDay(subDays(from, days)),
      to: endOfDay(subDays(from, 1)),
    },
    isCustom: true,
  };
}

/**
 * Resolves the window from URL params, including a custom `from`/`to` pair.
 *
 * Returns the custom dates back so the picker can show what is applied, and
 * falls back to a named period whenever they are missing or malformed.
 */
export function resolveRangeFromParams(
  params: { period?: string; from?: string; to?: string },
  fallback: PeriodKey = 'today',
): {
  period: PeriodKey;
  range: DateRange;
  custom: { from: string; to: string } | null;
} {
  if (params.period === 'custom') {
    const range = buildCustomRange(params.from, params.to);
    if (range && params.from && params.to) {
      return {
        period: 'custom',
        range,
        custom: { from: params.from, to: params.to },
      };
    }
  }

  const period = parsePeriod(params.period, fallback);
  return { period, range: resolveRange(period), custom: null };
}

function buildTrailing(now: Date, days: number, label: string): NamedRange {
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
  { value: 'lastMonth', label: 'Last month' },
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
