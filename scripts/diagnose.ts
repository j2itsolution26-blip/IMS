/**
 * Route data-path diagnostic.
 *
 * Every sidebar page is backed by one or more server queries. TypeScript can
 * verify their signatures but not their SQL, so this executes each one against
 * the live database and reports which throw.
 *
 * Run with:  npm run diagnose
 */

import { resolveRange } from '../src/server/analytics/date-range';
import { prisma } from '../src/lib/prisma';

const range = resolveRange('last30');
const results: { route: string; call: string; ok: boolean; error?: string }[] = [];

async function check(route: string, call: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    results.push({ route, call, ok: true });
  } catch (error) {
    results.push({
      route,
      call,
      ok: false,
      error: error instanceof Error ? error.message.split('\n').filter(Boolean).slice(0, 4).join(' | ') : String(error),
    });
  }
}

async function main() {
  const dashboard = await import('../src/server/analytics/dashboard');
  const salesAnalytics = await import('../src/server/analytics/sales-analytics');
  const inventoryAnalytics = await import('../src/server/analytics/inventory-analytics');
  const badges = await import('../src/server/analytics/badges');
  const reports = await import('../src/server/reports/registry');

  const inventoryQueries = await import('../src/features/inventory/queries');
  const catalogueQueries = await import('../src/features/catalogue/queries');
  const productQueries = await import('../src/features/products/queries');
  const salesQueries = await import('../src/features/sales/queries');

  // --- /dashboard ---
  await check('/dashboard', 'getSalesSummary', () => dashboard.getSalesSummary(range.from, range.to));
  await check('/dashboard', 'getInventorySnapshot', () => dashboard.getInventorySnapshot());
  await check('/dashboard', 'getRecentSales', () => dashboard.getRecentSales(6));
  await check('/dashboard', 'getRecentInventoryActivity', () => dashboard.getRecentInventoryActivity(8));
  await check('/dashboard', 'getSalesTimeSeries', () =>
    salesAnalytics.getSalesTimeSeries(range.from, range.to, 'day'),
  );
  await check('/dashboard', 'countActionableStock', () => badges.countActionableStock());

  // --- reports analytics helpers ---
  for (const dimension of ['category', 'employee'] as const) {
    await check('/reports', `getSalesBreakdown(${dimension})`, () =>
      salesAnalytics.getSalesBreakdown(dimension, range.from, range.to, 8),
    );
  }
  await check('/reports', 'getSalesByHour', () => salesAnalytics.getSalesByHour(range.from, range.to));
  await check('/reports', 'getMostReturnedProducts', () =>
    salesAnalytics.getMostReturnedProducts(range.from, range.to, 8),
  );
  await check('/reports', 'getPaymentMethodBreakdown', () =>
    salesAnalytics.getPaymentMethodBreakdown(range.from, range.to),
  );
  await check('/reports', 'getInventoryAging', () => inventoryAnalytics.getInventoryAging());
  await check('/reports', 'getInventoryTurnover', () =>
    inventoryAnalytics.getInventoryTurnover(range.from, range.to),
  );

  // --- /inventory ---
  await check('/inventory', 'getStockLevels(default)', () => inventoryAnalytics.getStockLevels({}));
  await check('/inventory', 'getStockLevels(status=LOW)', () => inventoryAnalytics.getStockLevels({ status: 'LOW' }));
  await check('/inventory', 'getStockLevels(search)', () => inventoryAnalytics.getStockLevels({ search: 'a' }));
  for (const kind of ['FAST', 'SLOW', 'DEAD'] as const) {
    await check('/inventory', `getMovementAnalysis(${kind})`, () =>
      inventoryAnalytics.getMovementAnalysis(kind, 10),
    );
  }
  await check('/inventory/movements', 'listMovements', () => inventoryQueries.listMovements({}));
  await check('/inventory/adjustments', 'getStockPickerProducts', () => inventoryQueries.getStockPickerProducts());

  // --- catalogue ---
  await check('/inventory', 'listCategories', () => catalogueQueries.listCategories());
  await check('/inventory', 'listUnits', () => catalogueQueries.listUnits());

  // --- /products ---
  await check('/products', 'listProducts', () => productQueries.listProducts({}));
  await check('/products/new', 'getProductFormOptions', () => productQueries.getProductFormOptions());

  // --- /sales & /pos ---
  await check('/sales', 'listSales', () => salesQueries.listSales({}));
  await check('/pos', 'searchSellableProducts', () => productQueries.searchSellableProducts('', 40));

  // --- simple prisma pages ---
  await check('/returns', 'return.findMany', () => prisma.return.findMany({ take: 5 }));
  await check('/settings', 'setting.findMany', () => prisma.setting.findMany({ take: 5 }));
  await check('/settings/users', 'user.findMany', () => prisma.user.findMany({ take: 5 }));
  await check('/settings/roles', 'role.findMany', () =>
    prisma.role.findMany({ include: { permissions: true, _count: { select: { users: true } } } }),
  );

  // --- /reports (every report in the registry) ---
  const currency = 'PHP';
  for (const report of reports.REPORTS) {
    await check(`/reports/${report.id}`, report.name, () => report.load(range, currency));
  }

  // --- output ---
  const failures = results.filter((r) => !r.ok);

  console.log('');
  console.log(`Checked ${results.length} data paths — ${results.length - failures.length} OK, ${failures.length} FAILED`);
  console.log('');

  if (failures.length > 0) {
    console.log('FAILURES');
    console.log('========');
    for (const failure of failures) {
      console.log(`\n  ${failure.route}  ->  ${failure.call}`);
      console.log(`    ${failure.error}`);
    }
    console.log('');
  } else {
    console.log('All data paths executed without error.');
  }

  await prisma.$disconnect();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('Diagnostic harness itself failed:', error);
  await prisma.$disconnect();
  process.exit(2);
});
