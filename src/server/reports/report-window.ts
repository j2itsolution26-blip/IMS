import 'server-only';

import { endOfDay, isValid, parseISO, startOfDay } from 'date-fns';
import { formatDate } from '@/lib/format';
import { parsePeriod, resolveRange, type DateRange, type PeriodKey } from '@/server/analytics/date-range';

/**
 * The reporting window behind the Reports dashboard and its exports.
 *
 * Presets are resolved by `resolveRange` exactly as everywhere else; the only
 * addition is a custom `from`/`to` pair. Both the screen and the export
 * endpoint resolve through here so a downloaded file can never cover a
 * different period than the figures the owner was looking at.
 */

export interface ReportWindow {
  /** The raw selection, for round-tripping the picker: a `PeriodKey` or `'custom'`. */
  period: string;
  from: Date;
  to: Date;
  label: string;
  /** Null when the window is a custom date range. */
  preset: PeriodKey | null;
}

export function resolveReportWindow(
  params: { period?: string; from?: string; to?: string },
  fallback: PeriodKey = 'today',
): ReportWindow {
  if (params.period === 'custom') {
    const first = parseISO(params.from ?? '');
    const second = parseISO(params.to ?? '');

    if (isValid(first) && isValid(second)) {
      // Accept the two dates in either order rather than rejecting a range
      // someone entered backwards.
      const [start, end] = first <= second ? [first, second] : [second, first];
      return {
        period: 'custom',
        from: startOfDay(start),
        to: endOfDay(end),
        label: `${formatDate(start)} – ${formatDate(end)}`,
        preset: null,
      };
    }
    // Falls through on an unparseable range, so a hand-edited URL shows a real
    // period rather than an error.
  }

  const preset = parsePeriod(params.period, fallback);
  const range = resolveRange(preset);
  return { period: preset, from: range.from, to: range.to, label: range.label, preset };
}

/** Adapts a window to the `DateRange` the report registry loads against. */
export function toDateRange(window: ReportWindow): DateRange {
  if (window.preset) return resolveRange(window.preset);

  const span = window.to.getTime() - window.from.getTime();
  return {
    from: window.from,
    to: window.to,
    label: window.label,
    previous: { from: new Date(window.from.getTime() - span), to: new Date(window.from.getTime() - 1) },
  };
}
