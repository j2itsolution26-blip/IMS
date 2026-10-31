import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { featureLines } from '@/features/billing/plan-card';

const read = (path: string) => readFileSync(path, 'utf8');

test('the owner page and the System Admin store page render plans through the one shared card', () => {
  const owner = read('src/features/billing/plan-cards.tsx');
  assert.match(owner, /from '@\/features\/billing\/plan-card'/);
  assert.match(owner, /<PlanCard\b/);
  assert.doesNotMatch(owner, /rounded-3xl border p-5/, 'the owner page has no card markup of its own');

  const admin = read('src/features/platform/store-detail-parts.tsx');
  assert.match(admin, /from '@\/features\/billing\/plan-card'/);
  assert.match(admin, /<PlanCard\b/);
  assert.doesNotMatch(admin, /PlanCardsReadOnly|PLAN_STYLE/, 'no separate admin plan design');

  assert.match(read('src/app/(app)/system-admin/stores/[id]/page.tsx'), /<AdminPlanCards\b/);
});

test('both views list the same plan contents, straight from the plan configuration', () => {
  const included = (plan: 'BASIC' | 'BUSINESS' | 'ENTERPRISE') => featureLines(plan).filter((line) => line.included).map((line) => line.text);
  const missing = (plan: 'BASIC' | 'BUSINESS' | 'ENTERPRISE') => featureLines(plan).filter((line) => !line.included).map((line) => line.text);

  assert.deepEqual(included('BASIC'), ['1 branch', 'Up to 2 staff accounts', 'Up to 1,500 products', '90-day audit history']);
  assert.deepEqual(missing('BASIC'), ['Background removals / month', 'Report exports', 'Custom roles']);
  assert.deepEqual(included('BUSINESS'), [
    'Up to 3 branches',
    'Up to 10 staff accounts',
    'Up to 5,000 products',
    'Up to 100 background removals / month',
    'Report exports',
    'Custom roles',
    '365-day audit history',
  ]);
  assert.deepEqual(missing('BUSINESS'), []);
  assert.deepEqual(included('ENTERPRISE'), [
    'Up to 10 branches',
    'Unlimited staff accounts',
    'Unlimited products',
    'Up to 1,000 background removals / month',
    'Report exports',
    'Custom roles',
    'Full audit history',
  ]);

  // No limit is written into the card itself: they all come from lib/plans.
  const card = read('src/features/billing/plan-card.tsx');
  assert.match(card, /PLANS\[id\]/);
  assert.doesNotMatch(card, /Up to \d|\d[\d,]*\s*(branch|staff|product|background|day)/i, 'no limit text written into the card');
  assert.doesNotMatch(card, /\b(limits|features|auditHistoryDays)\s*:\s*[{\d]/, 'no plan definition inside the card');
});

test('the System Admin plan cards offer no purchase action', () => {
  for (const path of ['src/features/platform/store-detail-parts.tsx', 'src/app/(app)/system-admin/stores/[id]/page.tsx']) {
    const source = read(path);
    assert.doesNotMatch(source, /selectPlanAction|ChangePlanDialog|features\/billing\/actions/, `${path} must not reach the owner's purchase flow`);
  }
});
