/**
 * Presentation helpers. These are pure and safe in both server and client
 * components — no Prisma types leak in, only plain numbers.
 */

export const DEFAULT_CURRENCY = 'PHP';
export const DEFAULT_LOCALE = 'en-PH';

export function formatCurrency(
  value: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = value ?? 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Compact form for KPI tiles: ₱1.2M instead of ₱1,240,533.00. */
export function formatCompactCurrency(
  value: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = value ?? 0;
  if (Math.abs(n) < 10_000) return formatCurrency(n, currency, locale);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return formatCurrency(n, currency, locale);
  }
}

export function formatNumber(value: number | null | undefined, maxDigits = 2): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, { maximumFractionDigits: maxDigits }).format(value ?? 0);
}

/** Drops trailing zeros so "5" reads as 5, not 5.000. */
export function formatQuantity(value: number | null | undefined): string {
  const n = value ?? 0;
  return Number.isInteger(n) ? formatNumber(n, 0) : formatNumber(n, 3);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)}%`;
}

export function formatSignedPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium' }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeStyle: 'short' }).format(d);
}

export function formatRelative(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return rtf.format(-Math.round(seconds / secondsInUnit), unit);
    }
  }
  return rtf.format(-seconds, 'second');
}

/** Turns SCREAMING_SNAKE enums into "Screaming Snake" for display. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
