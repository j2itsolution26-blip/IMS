import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eachStoreBucket,
  endOfStoreDay,
  endOfStoreMonth,
  endOfStoreWeek,
  parseStoreDay,
  startOfStoreDay,
  startOfStoreMonth,
  startOfStoreWeek,
  storeDayKey,
} from '@/lib/store-time';
import { buildCustomRange, resolveRange } from '@/server/analytics/date-range';
import { formatDateTime } from '@/lib/format';

// 2026-10-18 07:30 in Manila is 2026-10-17 23:30 UTC — the case a UTC server got wrong.
const EARLY_MORNING = new Date('2026-10-17T23:30:00Z');

test('store day starts at Manila midnight, not UTC midnight', () => {
  assert.equal(startOfStoreDay(EARLY_MORNING).toISOString(), '2026-10-17T16:00:00.000Z');
  assert.equal(endOfStoreDay(EARLY_MORNING).toISOString(), '2026-10-18T15:59:59.999Z');
  assert.equal(storeDayKey(EARLY_MORNING), '2026-10-18');
});

test('weeks run Monday to Sunday in store time', () => {
  // 2026-10-18 is a Sunday in Manila; its week began Monday 12 October.
  assert.equal(startOfStoreWeek(EARLY_MORNING).toISOString(), '2026-10-11T16:00:00.000Z');
  assert.equal(endOfStoreWeek(EARLY_MORNING).toISOString(), '2026-10-18T15:59:59.999Z');
  // A Monday is the first day of its own week.
  const monday = new Date('2026-10-19T01:00:00Z');
  assert.equal(startOfStoreWeek(monday).toISOString(), '2026-10-18T16:00:00.000Z');
});

test('months roll over the year boundary', () => {
  const january = new Date('2026-01-10T04:00:00Z');
  assert.equal(startOfStoreMonth(january, -1).toISOString(), '2025-11-30T16:00:00.000Z');
  assert.equal(endOfStoreMonth(january, -1).toISOString(), '2025-12-31T15:59:59.999Z');
});

test('parseStoreDay accepts real dates only', () => {
  assert.equal(parseStoreDay('2026-10-18')?.toISOString(), '2026-10-17T16:00:00.000Z');
  assert.equal(parseStoreDay('2026-02-31'), null);
  assert.equal(parseStoreDay('18/10/2026'), null);
  assert.equal(parseStoreDay(undefined), null);
});

test('named ranges use store boundaries and the right previous period', () => {
  const today = resolveRange('today', EARLY_MORNING);
  assert.equal(today.from.toISOString(), '2026-10-17T16:00:00.000Z');
  assert.equal(today.previous.from.toISOString(), '2026-10-16T16:00:00.000Z');
  assert.equal(today.previous.to.toISOString(), '2026-10-17T15:59:59.999Z');

  const week = resolveRange('week', EARLY_MORNING);
  assert.equal(week.previous.from.toISOString(), '2026-10-04T16:00:00.000Z');
  assert.equal(week.previous.to.toISOString(), '2026-10-11T15:59:59.999Z');

  const month = resolveRange('month', EARLY_MORNING);
  assert.equal(month.from.toISOString(), '2026-09-30T16:00:00.000Z');
  assert.equal(month.previous.from.toISOString(), '2026-08-31T16:00:00.000Z');

  const year = resolveRange('year', EARLY_MORNING);
  assert.equal(year.from.toISOString(), '2025-12-31T16:00:00.000Z');
});

test('custom ranges are inclusive, order-tolerant and bounded', () => {
  const range = buildCustomRange('2026-10-10', '2026-10-01');
  assert.ok(range);
  assert.equal(range.from.toISOString(), '2026-09-30T16:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-10-10T15:59:59.999Z');
  // Ten days, so the previous period is the ten days before.
  assert.equal(range.previous.from.toISOString(), '2026-09-20T16:00:00.000Z');
  assert.equal(range.previous.to.toISOString(), '2026-09-30T15:59:59.999Z');

  assert.equal(buildCustomRange('2026-13-01', '2026-10-01'), null);
  assert.equal(buildCustomRange('2010-01-01', '2026-10-01'), null);
});

test('buckets cover the window, including empty ones', () => {
  const today = resolveRange('today', EARLY_MORNING);
  const hours = eachStoreBucket(today.from, today.to, 'hour');
  assert.equal(hours.length, 24);
  assert.equal(hours[0].toISOString(), today.from.toISOString());

  const days = eachStoreBucket(resolveRange('week', EARLY_MORNING).from, resolveRange('week', EARLY_MORNING).to, 'day');
  assert.equal(days.length, 7);

  const months = eachStoreBucket(resolveRange('year', EARLY_MORNING).from, resolveRange('year', EARLY_MORNING).to, 'month');
  assert.equal(months.length, 12);
  assert.equal(months[11].toISOString(), '2026-11-30T16:00:00.000Z');
});

test('dates print in store time regardless of the process timezone', () => {
  assert.match(formatDateTime(EARLY_MORNING), /Oct 18, 2026/);
  assert.match(formatDateTime(EARLY_MORNING), /7:30/);
});
