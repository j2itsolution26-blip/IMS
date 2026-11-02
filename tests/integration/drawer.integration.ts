import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * The drawer from real records (PostgreSQL): the "Additional or revise"
 * brief's example — a cash sale, a GCash sale, GCash cash load / cash-in /
 * cash-out with a cash fee, and a drawer cash out — reconciles to ₱1,920.00.
 * GCash product sales are listed in the breakdown at ₱0 and never reach the
 * expected cash. The owner (shift detail) and the cashier (current shift)
 * read the same summary function.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('drawer (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`Refusing to run drawer tests against ${host}; use a local database.`);
  process.env.DATABASE_URL = URL_ENV;

  let platform: PrismaClient;
  let storeClient: (storeId: string, options?: { writable?: boolean }) => PrismaClient;
  const run = randomBytes(4).toString('hex');

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    ({ storeClient } = await import('@/lib/tenant/client'));
  });
  after(async () => {
    await platform?.$disconnect();
  });

  describe('drawer breakdown from records', () => {
    test('the brief example reconciles to ₱1,920.00 and is Balanced when ₱1,920.00 is counted', async () => {
      const { computeShiftSummary } = await import('@/server/services/shift-service');
      const { drawerBreakdown, cashVariance } = await import('@/lib/shift-math');
      const { limitsRow } = await import('@/server/platform/store-setup');

      const storeId = `dr_${run}`;
      await platform.store.create({ data: { id: storeId, name: storeId, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'BUSINESS', ...limitsRow({ plan: 'BUSINESS', status: 'ACTIVE' }) } });
      const db = storeClient(storeId);
      const branch = await db.warehouse.create({ data: { code: 'MAIN', name: 'Main', isDefault: true } });
      const role = await db.role.create({ data: { name: 'Owner', slug: 'owner', isSystem: true } });
      const user = await db.user.create({ data: { name: 'Joy Cruz', email: `${storeId}@dr.test`, username: `joy${run}`, roleId: role.id } });
      const shift = await db.cashierShift.create({ data: { userId: user.id, warehouseId: branch.id, openingCash: 1000 } });

      let n = 0;
      const sale = async (total: number, payments: { method: 'CASH' | 'GCASH'; amount: number }[], change = 0) => {
        const row = await db.sale.create({ data: { invoiceNumber: `INV-${run}-${++n}`, warehouseId: branch.id, userId: user.id, shiftId: shift.id, total, changeAmount: change } });
        for (const p of payments) {
          await db.payment.create({ data: { paymentNumber: `PAY-${run}-${n}-${p.method}`, direction: 'INBOUND', method: p.method, amount: p.amount, saleId: row.id, userId: user.id, shiftId: shift.id } });
        }
      };
      // Cash sales ₱1,000: ₱1,290 handed over, ₱290 change.
      await sale(1000, [{ method: 'CASH', amount: 1290 }], 290);
      // GCash product sale ₱1,380.25: a sale, but no drawer cash.
      await sale(1380.25, [{ method: 'GCASH', amount: 1380.25 }]);
      const wallet = (type: 'CASH_IN' | 'CASH_OUT', amount: number, fee: number, ref: string) =>
        db.walletTransaction.create({ data: { type, amount, fee, reference: `${ref}${run}`, shiftId: shift.id, userId: user.id } });
      await wallet('CASH_IN', 50, 0, 'LOAD'); // GCash cash load, paid in cash
      await wallet('CASH_IN', 20, 0, 'CIN'); // GCash cash-in, paid in cash
      await wallet('CASH_OUT', 100, 50, 'COUT'); // ₱100 out, ₱50 fee kept in cash
      await db.cashMovement.create({ data: { shiftId: shift.id, type: 'CASH_OUT', category: 'EXPENSE', amount: 100, reason: 'Petty cash', userId: user.id } });

      const summary = await computeShiftSummary(shift.id, 1000, db);
      assert.equal(summary.expectedCash, 1920);
      assert.deepEqual(
        { cashSales: summary.breakdown.cashSales, gcashSales: summary.breakdown.gcashSales, walletCashIn: summary.breakdown.walletCashIn, walletCashOut: summary.breakdown.walletCashOut, walletFees: summary.breakdown.walletFees, cashOut: summary.breakdown.cashOut },
        { cashSales: 1000, gcashSales: 1380.25, walletCashIn: 70, walletCashOut: 100, walletFees: 50, cashOut: 100 },
      );
      // The table the owner and cashier both see sums to the same figure, with GCash sales at ₱0.
      const table = drawerBreakdown(summary.breakdown);
      assert.equal(table.expectedCash, summary.expectedCash);
      assert.equal(table.rows.find((row) => row.key === 'gcashSales')?.drawerImpact, 0);
      assert.equal(summary.totalSales, 2380.25, 'all-payment sales still include the GCash sale');
      assert.deepEqual(cashVariance(1920, summary.expectedCash), { difference: 0, kind: 'BALANCED' });

      // A voided GCash sale drops out of every figure; a reversed GCash service too.
      await platform.sale.updateMany({ where: { invoiceNumber: `INV-${run}-2` }, data: { status: 'VOIDED', voidedAt: new Date(), voidedById: user.id, voidReason: 'test void' } });
      await platform.walletTransaction.updateMany({ where: { reference: `CIN${run}` }, data: { reversedAt: new Date(), reversedById: user.id, reversalReason: 'test' } });
      const after = await computeShiftSummary(shift.id, 1000, db);
      assert.equal(after.breakdown.gcashSales, 0);
      assert.equal(after.expectedCash, 1900);
    });
  });
}
