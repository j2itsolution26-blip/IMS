import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketPhases } from '@/lib/bucket-phases';

const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => `${d}T00:00:00.000Z`);

test('a running period has history, one bucket in progress, and buckets to come', () => {
  const { phases, currentIndex } = bucketPhases(days, new Date('2026-10-02T15:00:00Z'));
  assert.deepEqual(phases, ['past', 'current', 'future', 'future']);
  assert.equal(currentIndex, 1);
});

test('a finished period is all history, with no bucket in progress', () => {
  const { phases, currentIndex } = bucketPhases(days, new Date('2026-10-09T09:00:00Z'));
  assert.deepEqual(phases, ['past', 'past', 'past', 'past']);
  assert.equal(currentIndex, -1);
});

test('the last bucket is in progress while now falls inside it', () => {
  const { currentIndex } = bucketPhases(days, new Date('2026-10-04T08:00:00Z'));
  assert.equal(currentIndex, 3);
});

test('a period that has not started yet is all future', () => {
  const { phases, currentIndex } = bucketPhases(days, new Date('2026-09-30T23:00:00Z'));
  assert.deepEqual(phases, ['future', 'future', 'future', 'future']);
  assert.equal(currentIndex, -1);
});

test('no buckets, no phases', () => {
  assert.deepEqual(bucketPhases([], new Date()), { phases: [], currentIndex: -1 });
});
