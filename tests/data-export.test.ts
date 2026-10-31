import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_FEATURES } from '@/lib/plans';
import { DATA_EXPORTS, DATA_EXPORT_ROW_LIMIT, dataExportFilename, parseDataExport, salesExportStart } from '@/lib/data-export';
import { SYSTEM_ROLES, resolveRolePermissions } from '@/lib/permissions';

/**
 * "Download your data": a capped CSV of the store's own products and sales,
 * on every plan. The route and service are checked from their source; the
 * database half (only this store's rows) is in the integration suite.
 */

const route = readFileSync('src/app/api/data-export/[dataset]/route.ts', 'utf8');
const service = readFileSync('src/server/services/data-export-service.ts', 'utf8');

test('only products and sales can be downloaded, each behind its own export permission', () => {
  assert.deepEqual(Object.keys(DATA_EXPORTS).sort(), ['products', 'sales']);
  assert.equal(DATA_EXPORTS.products.permission, 'products.export');
  assert.equal(DATA_EXPORTS.sales.permission, 'sales.export');
  assert.equal(parseDataExport('sales'), 'sales');
  assert.equal(parseDataExport('users'), null);
  assert.equal(parseDataExport('constructor'), null);
  assert.equal(parseDataExport(undefined), null);
  // The owner holds both; a cashier holds neither.
  const perms = (slug: string) => resolveRolePermissions(SYSTEM_ROLES.find((r) => r.slug === slug)!);
  assert.ok(perms('owner').includes('products.export') && perms('owner').includes('sales.export'));
  assert.ok(!perms('cashier').includes('products.export') && !perms('cashier').includes('sales.export'));
});

test('limits: 10,000 rows, sales from the last 12 calendar months', () => {
  assert.equal(DATA_EXPORT_ROW_LIMIT, 10_000);
  assert.equal(salesExportStart(new Date('2026-11-01T03:00:00Z')).toISOString(), '2025-11-01T03:00:00.000Z');
  assert.equal(salesExportStart(new Date('2026-03-31T00:00:00Z'), 1).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(dataExportFilename('sales', new Date('2026-11-01T10:00:00Z')), 'sales-2026-11-01.csv');
  assert.match(service, /take: DATA_EXPORT_ROW_LIMIT \+ 1/);
  assert.match(service, /createdAt: \{ gte: salesExportStart\(now\), lte: now \}/);
});

test('the route is not a plan feature, but is authenticated, permissioned, scoped, rate-limited and audited', () => {
  assert.doesNotMatch(route, /featureDenial|requireFeature|reportExports/, 'available on every plan');
  assert.match(route, /if \(!user\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/);
  assert.match(route, /user\.permissions\.has\(definition\.permission\)/);
  assert.match(route, /getStoreContext\(\)/, 'the store-scoped client; a suspended store is refused there');
  assert.match(route, /buildDataExport\(ctx\.db,/);
  assert.match(route, /checkRateLimit\(`export:\$\{user\.id\}`, RATE_LIMITS\.export\)/);
  // Audited before the file is sent; a failed audit means no file.
  assert.ok(route.indexOf('await recordAudit(') < route.indexOf('toCsv(result)'));
  assert.match(route, /'Cache-Control': 'no-store'/);
});

test('cost figures need the financial permission; no emails, IPs or other accounts are exported', () => {
  assert.match(route, /const includeCost = user\.permissions\.has\(FINANCIAL_PERMISSION\)/);
  assert.match(service, /\.\.\.\(includeCost \? \[money\('costPrice'/);
  assert.match(service, /\.\.\.\(includeCost \? \[money\('costOfGoods'/);
  const code = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /email|ipAddress|userAgent|passwordHash|posPinHash|platformPrisma/);
});

test('the comparison lists the CSV download on every plan, and the buttons are not plan-gated', () => {
  assert.ok((CORE_FEATURES as readonly string[]).includes('CSV download of your products and sales'));
  for (const [page, dataset] of [['src/app/(app)/products/page.tsx', 'products'], ['src/app/(app)/sales/page.tsx', 'sales']] as const) {
    const source = readFileSync(page, 'utf8');
    assert.match(source, new RegExp(`<DownloadCsvButton dataset="${dataset}" />`));
    const button = source.indexOf(`<DownloadCsvButton dataset="${dataset}"`);
    const gateOpen = source.lastIndexOf('<PlanGate', button);
    const gateClose = source.lastIndexOf('</PlanGate>', button);
    assert.ok(gateOpen === -1 || gateClose > gateOpen, `${page}: the CSV button must sit outside any PlanGate`);
  }
});
