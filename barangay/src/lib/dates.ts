// The Philippines has used UTC+8 all year since 1990 (no daylight saving),
// so a fixed offset is exact.
const OFFSET_MS = 8 * 60 * 60 * 1000;

/** Year/month/day of an instant as seen in Manila. */
export function manilaParts(at: Date): { y: number; m: number; d: number } {
  const local = new Date(at.getTime() + OFFSET_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

/** Start of a Manila calendar day, as a UTC instant. */
export function manilaDayStart(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
}

export function manilaTodayRange(now = new Date()): { start: Date; end: Date } {
  const { y, m, d } = manilaParts(now);
  const start = manilaDayStart(y, m, d);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function manilaMonthRange(now = new Date()): { start: Date; end: Date } {
  const { y, m } = manilaParts(now);
  return { start: manilaDayStart(y, m, 1), end: manilaDayStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) };
}

/** Parse `YYYY-MM-DD` as a Manila day. Returns null when malformed. */
export function parseManilaDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = manilaDayStart(y, m, d);
  const back = manilaParts(date);
  return back.y === y && back.m === m && back.d === d ? date : null;
}

/** `YYYY-MM-DD` for a Manila day — for <input type="date"> values. */
export function toDateInput(at: Date): string {
  const { y, m, d } = manilaParts(at);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Age in whole years on `on`. Birth dates are stored as calendar dates
 * (midnight UTC), so read them with UTC getters.
 */
export function ageOn(birthDate: Date, on = new Date()): number {
  const today = manilaParts(on);
  const by = birthDate.getUTCFullYear();
  const bm = birthDate.getUTCMonth() + 1;
  const bd = birthDate.getUTCDate();
  let age = today.y - by;
  if (today.m < bm || (today.m === bm && today.d < bd)) age--;
  return age;
}

/** Latest birth date (calendar date, UTC midnight) of someone aged `years` today. */
export function bornOnOrBefore(years: number, on = new Date()): Date {
  const { y, m, d } = manilaParts(on);
  return new Date(Date.UTC(y - years, m - 1, d));
}

/** Parse `YYYY-MM-DD` as a calendar date at UTC midnight (for birth dates). */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

/** Parse a `<input type="datetime-local">` value as Manila local time. */
export function parseManilaDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const day = parseManilaDate(`${match[1]}-${match[2]}-${match[3]}`);
  const h = Number(match[4]);
  const min = Number(match[5]);
  if (!day || h > 23 || min > 59) return null;
  return new Date(day.getTime() + (h * 60 + min) * 60_000);
}
