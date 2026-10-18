import 'server-only';

import {
  buildCustomRange,
  parsePeriod,
  resolveRange,
  type DateRange,
  type PeriodKey,
} from '@/server/analytics/date-range';

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
    // Same store-day parsing as every other screen, so a custom report covers
    // exactly the days the Sales page and dashboard would.
    const range = buildCustomRange(params.from, params.to);
    if (range) {
      return { period: 'custom', from: range.from, to: range.to, label: range.label, preset: null };
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
    // Reached only for an explicit from/to, whose label is already dates.
    isCustom: true,
  };
}
