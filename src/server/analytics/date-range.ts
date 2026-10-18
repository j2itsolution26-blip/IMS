import {
  addStoreDays,
  endOfStoreDay,
  endOfStoreMonth,
  endOfStoreWeek,
  endOfStoreYear,
  fromStoreWall,
  parseStoreDay,
  startOfStoreDay,
  startOfStoreMonth,
  startOfStoreWeek,
  startOfStoreYear,
  storeDaysInclusive,
} from '@/lib/store-time';
import { formatDate } from '@/lib/format';

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

/**
 * Every boundary is a Manila trading-day boundary (see `@/lib/store-time`),
 * whatever timezone the server process runs in. Weeks run Monday to Sunday.
 */
export function resolveRange(period: PeriodKey, now: Date = new Date()): DateRange {
  return { ...resolveNamedRange(period, now), isCustom: false };
}

type NamedRange = Omit<DateRange, 'isCustom'>;

function dayWindow(day: Date) {
  return { from: startOfStoreDay(day), to: endOfStoreDay(day) };
}

function resolveNamedRange(period: PeriodKey, now: Date): NamedRange {
  switch (period) {
    case 'today':
      return { ...dayWindow(now), label: 'Today', previous: dayWindow(addStoreDays(now, -1)) };
    case 'yesterday':
      return {
        ...dayWindow(addStoreDays(now, -1)),
        label: 'Yesterday',
        previous: dayWindow(addStoreDays(now, -2)),
      };
    case 'week': {
      const from = startOfStoreWeek(now);
      const lastWeek = addStoreDays(from, -7);
      return {
        from,
        to: endOfStoreWeek(now),
        label: 'This week',
        previous: { from: lastWeek, to: endOfStoreWeek(lastWeek) },
      };
    }
    case 'month':
      return {
        from: startOfStoreMonth(now),
        to: endOfStoreMonth(now),
        label: 'This month',
        previous: { from: startOfStoreMonth(now, -1), to: endOfStoreMonth(now, -1) },
      };
    case 'lastMonth':
      return {
        from: startOfStoreMonth(now, -1),
        to: endOfStoreMonth(now, -1),
        label: 'Last month',
        previous: { from: startOfStoreMonth(now, -2), to: endOfStoreMonth(now, -2) },
      };
    case 'quarter':
      return {
        from: startOfStoreMonth(now, -2),
        to: endOfStoreDay(now),
        label: 'Last 3 months',
        previous: { from: startOfStoreMonth(now, -5), to: endOfStoreMonth(now, -3) },
      };
    case 'year':
      return {
        from: startOfStoreYear(now),
        to: endOfStoreYear(now),
        label: 'This year',
        previous: { from: startOfStoreYear(now, -1), to: endOfStoreYear(now, -1) },
      };
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
      const from = fromStoreWall(2000, 0, 1);
      return {
        from,
        to: endOfStoreDay(now),
        label: 'All time',
        previous: { from, to: from },
      };
    }
  }
}

/** Longest custom window accepted — beyond this a chart stops being readable. */
export const MAX_CUSTOM_RANGE_DAYS = 366 * 5;

/**
 * A window from two `YYYY-MM-DD` store dates, inclusive of both.
 *
 * Returns null for anything unreadable, an impossible date, or a span longer
 * than `MAX_CUSTOM_RANGE_DAYS`, so callers fall back to a named period.
 */
export function buildCustomRange(fromValue: string | undefined, toValue: string | undefined): DateRange | null {
  const a = parseStoreDay(fromValue);
  const b = parseStoreDay(toValue);
  if (!a || !b) return null;

  // Tolerate the dates arriving the wrong way round rather than showing nothing.
  const [start, end] = a <= b ? [a, b] : [b, a];
  const from = startOfStoreDay(start);
  const to = endOfStoreDay(end);
  const days = storeDaysInclusive(from, to);
  if (days > MAX_CUSTOM_RANGE_DAYS) return null;

  return {
    from,
    to,
    label: `${formatDate(from)} – ${formatDate(to)}`,
    previous: {
      from: addStoreDays(from, -days),
      to: endOfStoreDay(addStoreDays(from, -1)),
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
  now: Date = new Date(),
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
  return { period, range: resolveRange(period, now), custom: null };
}

function buildTrailing(now: Date, days: number, label: string): NamedRange {
  const to = endOfStoreDay(now);
  const from = startOfStoreDay(addStoreDays(now, -(days - 1)));
  return {
    from,
    to,
    label,
    previous: {
      from: addStoreDays(from, -days),
      to: endOfStoreDay(addStoreDays(from, -1)),
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
