import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_FEATURES, PLANS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { annualSavingsLabel, annualSavingsPercent, planCtaKind, planPricing, type BillingInterval } from '@/lib/billing';
import { highlightLines } from '@/features/billing/plan-card';
import { comparisonRows } from '@/features/billing/plan-comparison';

/** The published price list the pricing page is designed around. */
const PRICES: { plan: PlanId; interval: BillingInterval; amount: number }[] = [
  { plan: 'BASIC', interval: 'MONTHLY', amount: 499 },
  { plan: 'BASIC', interval: 'ANNUAL', amount: 4990 },
  { plan: 'BUSINESS', interval: 'MONTHLY', amount: 999 },
  { plan: 'BUSINESS', interval: 'ANNUAL', amount: 9990 },
  { plan: 'ENTERPRISE', interval: 'MONTHLY', amount: 1499 },
  { plan: 'ENTERPRISE', interval: 'ANNUAL', amount: 14990 },
];

test('annual savings are worked out from the published prices: ₱998, ₱1,998, ₱2,998, all 17%', () => {
  const savings = PLAN_ORDER.map((id) => planPricing(PRICES, id).annualSavings);
  assert.deepEqual(savings, [998, 1998, 2998]);
  assert.deepEqual(PLAN_ORDER.map((id) => annualSavingsPercent(planPricing(PRICES, id))), [17, 17, 17]);
  assert.equal(annualSavingsLabel(PRICES), 'Save 17%');
});

test('switching the period switches every price; nothing is assumed for a missing price', () => {
  const basic = planPricing(PRICES, 'BASIC');
  assert.equal(basic.monthly, 499);
  assert.equal(basic.annual, 4990);
  // Only monthly published: no annual price, no saving, no toggle label.
  const monthlyOnly = PRICES.filter((p) => p.interval === 'MONTHLY');
  assert.equal(planPricing(monthlyOnly, 'BASIC').annual, null);
  assert.equal(annualSavingsLabel(monthlyOnly), null);
  // Plans that save different amounts read "up to".
  const mixed = PRICES.map((p) => (p.plan === 'ENTERPRISE' && p.interval === 'ANNUAL' ? { ...p, amount: 17000 } : p));
  assert.equal(annualSavingsLabel(mixed), 'Save up to 17%');
});

test('buttons follow the current plan: current, upgrade, downgrade, or unavailable without prices', () => {
  const on = (paidPlan: PlanId, plan: PlanId, priced = true) => planCtaKind(plan, { paidPlan, effectivePlan: paidPlan, onTrial: false, priced });
  assert.equal(on('BUSINESS', 'BUSINESS'), 'CURRENT');
  assert.equal(on('BUSINESS', 'ENTERPRISE'), 'UPGRADE');
  assert.equal(on('BUSINESS', 'BASIC'), 'DOWNGRADE');
  assert.equal(on('BASIC', 'BUSINESS', false), 'UNAVAILABLE');
  assert.equal(planCtaKind('BUSINESS', { paidPlan: null, effectivePlan: 'BASIC', onTrial: true, priced: true }), 'CHOOSE');
});

test('cards lead with the core features on Basic and "Everything in …" above it', () => {
  assert.deepEqual(highlightLines('BASIC'), [...CORE_FEATURES]);
  assert.deepEqual(highlightLines('BUSINESS'), ['Everything in Basic']);
  assert.deepEqual(highlightLines('ENTERPRISE'), ['Everything in Business']);
});

test('the comparison table reads from the plan configuration, including the 1,500-product Basic limit', () => {
  const rows = comparisonRows().flatMap((group) => group.rows);
  const row = (label: string) => PLAN_ORDER.map((id) => rows.find((r) => r.label === label)!.value(PLANS[id]));
  // One location on every plan until multi-branch is built; it is announced, never sold as capacity.
  assert.deepEqual(row('Locations'), ['1', '1', '1']);
  assert.deepEqual(row('Multi-branch (more than one location per store)'), ['Coming soon', 'Coming soon', 'Coming soon']);
  assert.deepEqual(row('Staff accounts'), ['2', '10', 'Unlimited']);
  assert.deepEqual(row('Products'), ['1,500', '5,000', 'Unlimited']);
  assert.deepEqual(row('Report exports'), [false, true, true]);
  assert.deepEqual(row('Custom roles and permission editing'), [false, true, true]);
  assert.deepEqual(row('Audit history'), ['90 days', '365 days', 'Full history']);
  assert.deepEqual(row('Support'), ['Help desk tickets', 'Help desk tickets', 'Help desk tickets']);
});

test('the pricing page promises nothing that is not built', () => {
  const sources = ['src/features/billing/plan-cards.tsx', 'src/features/billing/plan-card.tsx', 'src/features/billing/plan-comparison.tsx', 'src/lib/plans.ts']
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(sources, /priority support|branch analytics|branch monitoring|access management|low-stock alerts|stock-transfer/i);
  // No plan sells more than one location while multi-branch is not built.
  for (const id of PLAN_ORDER) assert.equal(PLANS[id].limits.branches, 1, `${id} must not advertise extra branches`);
  // Prices are never written into the page: they come from the published price list.
  assert.doesNotMatch(readFileSync('src/features/billing/plan-cards.tsx', 'utf8'), /₱\s?\d|\b(499|999|1499|4990|9990|14990)\b/);
});
