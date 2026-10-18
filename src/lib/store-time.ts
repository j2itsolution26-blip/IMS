/**
 * The store's calendar.
 *
 * Every "today", "this week" and "this month" in the app is a Manila trading
 * day, whatever clock the server runs on. Vercel runs functions in UTC, so
 * date-fns' `startOfDay` there opened "today" at 8:00 AM Manila time and
 * pushed the first hours of trade into yesterday.
 *
 * The Philippines has observed no daylight saving since 1978, so the store
 * offset is a constant and the arithmetic below needs no timezone database:
 * shift the instant into store wall-clock time, read it with the UTC getters,
 * and shift the result back. Pure and dependency-free, so it runs the same in
 * a server component, a client component and a unit test.
 */

export const STORE_TIME_ZONE = 'Asia/Manila';

const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The store's wall-clock reading of an instant. */
export interface StoreParts {
  year: number;
  /** 0-based, like `Date#getMonth`. */
  month: number;
  day: number;
  hour: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export function storeParts(date: Date): StoreParts {
  const wall = new Date(date.getTime() + OFFSET_MS);
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth(),
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    weekday: wall.getUTCDay(),
  };
}

/**
 * The instant at which a store wall-clock time occurs. `Date.UTC` normalises
 * overflow, so month -1 or day 0 land on the right neighbouring date.
 */
export function fromStoreWall(year: number, month: number, day = 1, hour = 0): Date {
  return new Date(Date.UTC(year, month, day, hour) - OFFSET_MS);
}

/** Inclusive end of a window that ends just before `nextStart`. */
const justBefore = (nextStart: Date) => new Date(nextStart.getTime() - 1);

export function addStoreDays(date: Date, days: number): Date {
  // Constant offset, so every store day is exactly 24 hours long.
  return new Date(date.getTime() + days * DAY_MS);
}

export function startOfStoreDay(date: Date): Date {
  const p = storeParts(date);
  return fromStoreWall(p.year, p.month, p.day);
}

export function endOfStoreDay(date: Date): Date {
  return justBefore(addStoreDays(startOfStoreDay(date), 1));
}

export function startOfStoreHour(date: Date): Date {
  const p = storeParts(date);
  return fromStoreWall(p.year, p.month, p.day, p.hour);
}

/** Weeks run Monday to Sunday. */
export function startOfStoreWeek(date: Date): Date {
  const p = storeParts(date);
  const sinceMonday = (p.weekday + 6) % 7;
  return fromStoreWall(p.year, p.month, p.day - sinceMonday);
}

export function endOfStoreWeek(date: Date): Date {
  return justBefore(addStoreDays(startOfStoreWeek(date), 7));
}

/** `offset` months away from the month containing `date`. */
export function startOfStoreMonth(date: Date, offset = 0): Date {
  const p = storeParts(date);
  return fromStoreWall(p.year, p.month + offset, 1);
}

export function endOfStoreMonth(date: Date, offset = 0): Date {
  return justBefore(startOfStoreMonth(date, offset + 1));
}

export function startOfStoreYear(date: Date, offset = 0): Date {
  return fromStoreWall(storeParts(date).year + offset, 0, 1);
}

export function endOfStoreYear(date: Date, offset = 0): Date {
  return justBefore(startOfStoreYear(date, offset + 1));
}

/** Store calendar days from `from` to `to`, counting both ends. */
export function storeDaysInclusive(from: Date, to: Date): number {
  return Math.round((startOfStoreDay(to).getTime() - startOfStoreDay(from).getTime()) / DAY_MS) + 1;
}

/** Parses the `YYYY-MM-DD` a date input produces as the start of that store day. */
export function parseStoreDay(value: string | undefined | null): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const start = fromStoreWall(year, month, day);
  // Reject 2026-02-31 rather than silently rolling it into March.
  const p = storeParts(start);
  return p.year === year && p.month === month && p.day === day ? start : null;
}

/** The store date of an instant as `YYYY-MM-DD`, for date inputs and URLs. */
export function storeDayKey(date: Date): string {
  const p = storeParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

export type BucketUnit = 'hour' | 'day' | 'week' | 'month' | 'year';

const BUCKET_START: Record<BucketUnit, (date: Date) => Date> = {
  hour: startOfStoreHour,
  day: startOfStoreDay,
  week: startOfStoreWeek,
  month: (date) => startOfStoreMonth(date),
  year: (date) => startOfStoreYear(date),
};

function nextBucket(start: Date, unit: BucketUnit): Date {
  switch (unit) {
    case 'hour':
      return new Date(start.getTime() + 60 * 60 * 1000);
    case 'day':
      return addStoreDays(start, 1);
    case 'week':
      return addStoreDays(start, 7);
    case 'month':
      return startOfStoreMonth(start, 1);
    case 'year':
      return startOfStoreYear(start, 1);
  }
}

export function startOfStoreBucket(date: Date, unit: BucketUnit): Date {
  return BUCKET_START[unit](date);
}

/**
 * Every bucket start touching `[from, to]`, in store time. These are the same
 * instants the database produces when it truncates in the store's zone, so a
 * queried bucket and an empty slot can be matched by timestamp.
 */
export function eachStoreBucket(from: Date, to: Date, unit: BucketUnit, max = 1000): Date[] {
  const slots: Date[] = [];
  for (let at = startOfStoreBucket(from, unit); at <= to && slots.length < max; at = nextBucket(at, unit)) {
    slots.push(at);
  }
  return slots;
}
