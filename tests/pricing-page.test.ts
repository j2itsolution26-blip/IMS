import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_FEATURES, PLANS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { annualSavingsLabel, annualSavingsPercent, planCtaKind, planPricing, type BillingInterval } from '@/lib/billing';
import { BRANCH_VIEW_LINE, capacityRows, locationLine, planHighlights } from '@/features/billing/plan-card';
import { planReason } from '@/features/billing/plan-reasons';
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

  const cards = readFileSync('src/features/billing/plan-cards.tsx', 'utf8');
  assert.ok(cards.includes("{cta === 'CURRENT' ? 'Current Plan' : 'Current Plan (Trial)'}"));
  assert.ok(cards.includes("CHOOSE: 'Choose', UPGRADE: 'Upgrade to', DOWNGRADE: 'Downgrade to'"));
  assert.ok(cards.includes("ANNUAL: 'Annual'"), 'the toggle reads Monthly | Annual');
});

test('cards show a short, even list and keep everything else behind "View all features"', () => {
  const basic = planHighlights('BASIC');
  const business = planHighlights('BUSINESS');
  const enterprise = planHighlights('ENTERPRISE');
  assert.deepEqual(basic.lead, [CORE_FEATURES[0], CORE_FEATURES[1], CORE_FEATURES[4], CORE_FEATURES[6]]);
  assert.deepEqual(business.lead, ['Everything in Basic', BRANCH_VIEW_LINE, 'Report exports (CSV, Excel, PDF)', 'Custom roles and permission editing']);
  assert.deepEqual(enterprise.lead, [
    'Everything in Business',
    'Two more store locations (five instead of three)',
    'Unlimited staff accounts (instead of ten)',
    'Unlimited products (instead of 5,000)',
  ]);
  for (const id of PLAN_ORDER) {
    const { lead, all } = planHighlights(id);
    assert.ok(lead.length <= 4, `${id} shows at most four lines`);
    for (const feature of CORE_FEATURES) assert.ok(all.includes(feature), `${id} lists ${feature} under all features`);
  }
  // Only plans with more than one location offer the per-branch view.
  assert.ok(!basic.all.includes(BRANCH_VIEW_LINE));
  assert.ok(business.all.includes(BRANCH_VIEW_LINE) && enterprise.all.includes(BRANCH_VIEW_LINE));
  assert.ok(!basic.all.some((line) => /Report exports|Custom roles|background removal/i.test(line)), 'Basic lists nothing it does not include');

  const card = readFileSync('src/features/billing/plan-card.tsx', 'utf8');
  assert.match(card, /<details className="group mt-3/, '"View all features" is a native disclosure');
  assert.ok(card.includes('View all features'));
});

test('limits under the price, from the plan configuration: staff, products, history', () => {
  const text = (id: PlanId) => capacityRows(id).map((row) => row.text);
  assert.deepEqual(text('BASIC'), ['Up to 3 staff accounts', 'Up to 1,500 products', '90-day activity history']);
  assert.equal(capacityRows('BASIC')[0].detail, '2 Cashiers, 1 Inventory Staff');
  assert.deepEqual(text('BUSINESS'), ['Up to 10 staff accounts', 'Up to 5,000 products', '365-day activity history']);
  assert.deepEqual(text('ENTERPRISE'), ['Unlimited staff accounts', 'Unlimited products', 'Full activity history']);
});

test('the comparison table reads from the plan configuration and the published prices', () => {
  const rows = comparisonRows(PRICES).flatMap((group) => group.rows);
  const row = (label: string) => PLAN_ORDER.map((id) => rows.find((r) => r.label === label)!.value(PLANS[id]));
  assert.deepEqual(row('Monthly price'), ['₱499.00', '₱999.00', '₱1,499.00']);
  assert.deepEqual(row('Annual price'), ['₱4,990.00', '₱9,990.00', '₱14,990.00']);
  assert.deepEqual(row('Locations (physical stores)'), ['1', '3', '5']);
  assert.deepEqual(row('Branch-level monitoring (each branch or all together)'), [false, true, true]);
  assert.deepEqual(row('Stock transfers between branches'), ['Coming soon', 'Coming soon', 'Coming soon']);
  assert.deepEqual(row('Staff accounts'), ['3', '10', 'Unlimited']);
  assert.deepEqual(row('Staff roles'), ['2 Cashiers, 1 Inventory Staff', 'Any mix', 'Any mix']);
  assert.deepEqual(row('Products'), ['1,500', '5,000', 'Unlimited']);
  for (const label of ['POS checkout', 'Barcode scanning', 'Cashier shift management', 'Cash reconciliation', 'Sales dashboard and standard reports']) {
    assert.deepEqual(row(label), [true, true, true], label);
  }
  assert.deepEqual(row('Report exports (CSV, Excel, PDF)'), [false, true, true]);
  assert.deepEqual(row('Role and permission customization'), [false, true, true]);
  assert.deepEqual(row('Activity / audit history'), ['90 days', '365 days', 'Full history']);
  assert.deepEqual(row('Support'), ['Help desk tickets', 'Help desk tickets', 'Help desk tickets']);

  // No prices published: no price rows; monthly only: no annual row.
  assert.ok(!comparisonRows([]).some((group) => group.group === 'Price'));
  const monthlyOnly = comparisonRows(PRICES.filter((p) => p.interval === 'MONTHLY')).flatMap((group) => group.rows);
  assert.ok(monthlyOnly.some((r) => r.label === 'Monthly price') && !monthlyOnly.some((r) => r.label === 'Annual price'));
});

test('the pricing page promises nothing that is not built', () => {
  const sources = [
    'src/features/billing/plan-cards.tsx',
    'src/features/billing/plan-card.tsx',
    'src/features/billing/plan-comparison.tsx',
    'src/features/billing/plan-reasons.ts',
    'src/features/billing/plan-why-dialog.tsx',
    'src/lib/plans.ts',
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(sources, /priority support|branch analytics|branch monitoring|access management|low-stock alerts|stock-transfer/i);
  // Locations are the enforced limits: Basic 1, Business 3, Enterprise 5.
  assert.deepEqual(PLAN_ORDER.map((id) => PLANS[id].limits.branches), [1, 3, 5]);
  // Prices are never written into the page: they come from the published price list.
  for (const path of ['src/features/billing/plan-cards.tsx', 'src/features/billing/plan-card.tsx', 'src/features/billing/plan-comparison.tsx']) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /₱\s?\d|\b(499|999|1499|4990|9990|14990)\b/, path);
  }
});

test('every card shows its locations as physical stores: 1, up to 3, up to 5', () => {
  assert.deepEqual(locationLine('BASIC'), { headline: '1 location included', detail: 'One physical store' });
  assert.deepEqual(locationLine('BUSINESS'), { headline: 'Up to 3 locations', detail: 'Physical stores or branches, viewed one by one or together' });
  assert.deepEqual(locationLine('ENTERPRISE'), { headline: 'Up to 5 locations', detail: 'Physical stores or branches, viewed one by one or together' });
});

test('the plan in force shows locations in use, counted as the limit is enforced, with the right next step', () => {
  const page = readFileSync('src/app/(app)/settings/subscription/page.tsx', 'utf8');
  assert.ok(page.includes("locationsUsed={meters.find((meter) => meter.key === 'branches')?.used ?? null}"), 'the same count usageSummary enforces');
  assert.ok(page.includes("canAddBranch={userCan(user, 'branches.manage')}"));
  const cards = readFileSync('src/features/billing/plan-cards.tsx', 'utf8');
  assert.ok(cards.includes('if (id !== effectivePlan || locationsUsed === null) return null;'), 'usage only on the plan in force');
  assert.ok(cards.includes("addHref: room && canAddBranch && !suspended ? '/settings/branches' : null"), 'no add link when full, suspended or not allowed');
  const card = readFileSync('src/features/billing/plan-card.tsx', 'utf8');
  assert.ok(card.includes('of ${formatNumber(limit, 0)} locations used'));
});

test('each plan has its own "Why …?" explanation, read from the plan configuration', () => {
  const card = readFileSync('src/features/billing/plan-card.tsx', 'utf8');
  assert.match(card, /<PlanWhyButton plan=\{id\} \/>/, 'the shared card renders the button for its own plan');
  assert.ok(readFileSync('src/features/billing/plan-why-dialog.tsx', 'utf8').includes('Why {plan.name}?'));

  const basic = planReason('BASIC');
  assert.match(basic.headline, /^Best for a single sari-sari store/);
  assert.equal(basic.locationNote, 'Only one physical store location is included.');
  assert.deepEqual(basic.limits.map((l) => l.text), [
    'One store location',
    'Up to three staff accounts (2 Cashiers, 1 Inventory Staff)',
    'Up to 1,500 products',
    '90-day activity history',
  ]);
  assert.equal(basic.versus, null);
  assert.ok(!basic.benefits.some((b) => /each branch/i.test(b.text)), 'Basic has one location, so no per-branch view');

  const business = planReason('BUSINESS');
  assert.match(business.headline, /operate multiple stores/);
  assert.equal(business.versus?.name, 'Basic');
  assert.equal(business.versus?.gains[0], 'Two more store locations (three instead of one)');
  assert.ok(business.versus?.gains.includes('Report exports (CSV, Excel, PDF)'));

  const enterprise = planReason('ENTERPRISE');
  assert.match(enterprise.headline, /several physical stores/);
  assert.equal(enterprise.versus?.gains[0], 'Two more store locations (five instead of three)');
  assert.ok(enterprise.limits.some((l) => l.text === 'Unlimited staff accounts'));
  assert.ok(enterprise.limits.some((l) => l.text === 'Full activity history'));
  for (const id of PLAN_ORDER) {
    assert.deepEqual([...planReason(id).limits, ...planReason(id).benefits].filter((b) => b.soon), [], `${id} lists only what ships`);
  }
});
