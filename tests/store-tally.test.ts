import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyStores } from '@/lib/subscription';

test('an empty platform reports every status and plan at zero', () => {
  assert.deepEqual(tallyStores([]), {
    total: 0,
    byStatus: { TRIAL: 0, ACTIVE: 0, PAST_DUE: 0, SUSPENDED: 0 },
    byPlan: { BASIC: 0, BUSINESS: 0, ENTERPRISE: 0 },
  });
});

test('grouped counts fold into totals by status and by plan', () => {
  const tally = tallyStores([
    { status: 'TRIAL', plan: 'BUSINESS', count: 3 },
    { status: 'ACTIVE', plan: 'BASIC', count: 2 },
    { status: 'ACTIVE', plan: 'ENTERPRISE', count: 1 },
    { status: 'SUSPENDED', plan: 'BASIC', count: 1 },
  ]);
  assert.equal(tally.total, 7);
  assert.deepEqual(tally.byStatus, { TRIAL: 3, ACTIVE: 3, PAST_DUE: 0, SUSPENDED: 1 });
  assert.deepEqual(tally.byPlan, { BASIC: 3, BUSINESS: 3, ENTERPRISE: 1 });
});
