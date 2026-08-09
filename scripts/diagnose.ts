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
  const insights = await import('../src/server/analytics/insights');
  const badges = await import('../src/server/analytics/badges');
  const reports = await import('../src/server/reports/registry');

  const inventoryQueries = await import('../src/features/inventory/queries');
  const catalogueQueries = await import('../src/features/catalogue/queries');
  const productQueries = await import('../src/features/products/queries');
  const salesQueries = await import('../src/features/sales/queries');
  const purchaseQueries = await import('../src/features/purchases/queries');

  // --- /dashboard ---
  await check('/dashboard', 'getComparedSalesSummary', () => dashboard.getComparedSalesSummary(range));
  await check('/dashboard', 'getInventorySnapshot', () => dashboard.getInventorySnapshot());
  await check('/dashboard', 'getReorderSuggestions', () => dashboard.getReorderSuggestions(6));
  await check('/dashboard', 'getSupplierAlerts', () => dashboard.getSupplierAlerts(4));
  await check('/dashboard', 'getRecentSales', () => dashboard.getRecentSales(6));
  await check('/dashboard', 'getRecentPurchases', () => dashboard.getRecentPurchases(6));
  await check('/dashboard', 'getRecentInventoryActivity', () => dashboard.getRecentInventoryActivity(8));
  await check('/dashboard', 'getProductPerformance(desc)', () =>
    dashboard.getProductPerformance({ from: range.from, to: range.to, sort: 'units', direction: 'desc', limit: 5 }),
  );
  await check('/dashboard', 'getProductPerformance(asc,unsold)', () =>
    dashboard.getProductPerformance({ from: range.from, to: range.to, sort: 'units', direction: 'asc', limit: 5, includeUnsold: true }),
  );
  await check('/dashboard', 'getSalesTimeSeries', () =>
    salesAnalytics.getSalesTimeSeries(range.from, range.to, 'day'),
  );
  await check('/dashboard', 'generateInsights', () => insights.generateInsights(6));
  await check('/dashboard', 'countActionableStock', () => badges.countActionableStock());

  // --- /analytics ---
  for (const dimension of ['category', 'brand', 'supplier', 'employee'] as const) {
    await check('/analytics', `getSalesBreakdown(${dimension})`, () =>
      salesAnalytics.getSalesBreakdown(dimension, range.from, range.to, 8),
    );
  }
  await check('/analytics', 'getSalesByHour', () => salesAnalytics.getSalesByHour(range.from, range.to));
  await check('/analytics', 'getTopCustomers', () => salesAnalytics.getTopCustomers(range.from, range.to, 8));
  await check('/analytics', 'getMostReturnedProducts', () =>
    salesAnalytics.getMostReturnedProducts(range.from, range.to, 8),
  );
  await check('/analytics', 'getPaymentMethodBreakdown', () =>
    salesAnalytics.getPaymentMethodBreakdown(range.from, range.to),
  );
  await check('/analytics', 'getInventoryAging', () => inventoryAnalytics.getInventoryAging());
  await check('/analytics', 'getInventoryTurnover', () =>
    inventoryAnalytics.getInventoryTurnover(range.from, range.to),
  );
  await check('/analytics', 'getSupplierPerformance', () =>
    inventoryAnalytics.getSupplierPerformance(range.from, range.to, 8),
  );
  await check('/analytics', 'getPurchaseTrends', () =>
    inventoryAnalytics.getPurchaseTrends(range.from, range.to, 'month'),
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
  await check('/inventory/adjustments', 'listActiveWarehouses', () => inventoryQueries.listActiveWarehouses());
  await check('/inventory/adjustments', 'getStockPickerProducts', async () => {
    const warehouses = await inventoryQueries.listActiveWarehouses();
    return warehouses[0] ? inventoryQueries.getStockPickerProducts(warehouses[0].id) : [];
  });

  // --- catalogue ---
  await check('/categories', 'listCategories', () => catalogueQueries.listCategories());
  await check('/brands', 'listBrands', () => catalogueQueries.listBrands());
  await check('/units', 'listUnits', () => catalogueQueries.listUnits());
  await check('/warehouses', 'listWarehouses', () => catalogueQueries.listWarehouses());
  await check('/suppliers', 'listSuppliers', () => catalogueQueries.listSuppliers());
  await check('/customers', 'listCustomers', () => catalogueQueries.listCustomers());

  // --- /products ---
  await check('/products', 'listProducts', () => productQueries.listProducts({}));
  await check('/products/new', 'getProductFormOptions', () => productQueries.getProductFormOptions());

  // --- /sales & /pos ---
  await check('/sales', 'listSales', () => salesQueries.listSales({}));
  await check('/pos', 'searchSellableProducts', async () => {
    const warehouses = await inventoryQueries.listActiveWarehouses();
    return warehouses[0] ? productQueries.searchSellableProducts('', warehouses[0].id, 40) : [];
  });

  // --- /purchases ---
  await check('/purchases', 'listPurchaseOrders', () => purchaseQueries.listPurchaseOrders({}));
  await check('/purchases/new', 'getPurchaseFormOptions', () => purchaseQueries.getPurchaseFormOptions());

  // --- simple prisma pages ---
  await check('/returns', 'return.findMany', () => prisma.return.findMany({ take: 5 }));
  await check('/payments', 'payment.findMany', () => prisma.payment.findMany({ take: 5 }));
  await check('/expenses', 'expense.findMany', () => prisma.expense.findMany({ take: 5 }));
  await check('/notifications', 'notification.findMany', () => prisma.notification.findMany({ take: 5 }));
  await check('/audit', 'auditLog.findMany', () => prisma.auditLog.findMany({ take: 5 }));
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
