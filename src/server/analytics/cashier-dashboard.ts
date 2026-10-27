import 'server-only';

import type { PaymentMethod, SaleStatus } from '@prisma/client';
import { storeDb } from '@/lib/tenant/context';
import { D, money, toNum } from '@/lib/decimal';
import { endOfStoreDay, startOfStoreDay } from '@/lib/store-time';
import { COMPLETED_TRANSACTION_STATUSES } from '@/lib/sales-scope';
import { cashierCashWindow, type CashierCashWindow } from '@/lib/cashier-window';
import { computeShiftSummary, getOpenShift, type OpenShiftSummary, type ShiftCloseSummary } from '@/server/services/shift-service';
import { getInventoryKpis } from '@/server/analytics/inventory-dashboard';
import { getStockLevels } from '@/server/analytics/inventory-analytics';
import { recentCashMovements, type CashMovementRow } from '@/server/services/cash-movement-queries';

/**
 * Everything the cashier dashboard shows, read for one cashier.
 *
 * Every sales and payment figure is filtered by the cashier's own id (or
 * their own open shift) here on the server — this module never reads another
 * cashier's sales or the store's takings. Inventory figures are counts and
 * pieces only: no cost, price history or stock value is selected.
 */

export interface CashierRecentSale {
  id: string;
  invoiceNumber: string;
  createdAt: Date;
  total: number;
  status: SaleStatus;
  /** Null for a sale with no payment row; 'Split' when more than one method paid. */
  paymentMethod: PaymentMethod | 'Split' | null;
}

export interface CashierStockAlert {
  productId: string;
  name: string;
  code: string;
  imageUrl: string | null;
  available: number;
  threshold: number;
}

export interface CashierDashboardData {
  shift: OpenShiftSummary | null;
  /** Live drawer figures for the open shift, from the server's shift maths. */
  shiftSummary: ShiftCloseSummary | null;
  cashWindow: CashierCashWindow;
  transactionsToday: number;
  cashCollected: number;
  productsAvailable: number;
  lowStockAlerts: number;
  outOfStock: number;
  recentSales: CashierRecentSale[];
  stockAlerts: CashierStockAlert[];
  /** The cashier's own latest cash in / out entries, newest first. */
  cashMovements: CashMovementRow[];
  /** The cashier's own cash out today (corrections that put cash back are cash in, so not counted). */
  cashOutToday: { amount: number; count: number };
}

const RECENT_SALES = 8;
const STOCK_ALERTS = 8;
const RECENT_MOVEMENTS = 5;

export async function getCashierDashboard(userId: string, now: Date = new Date()): Promise<CashierDashboardData> {
  const db = await storeDb();
  const shift = await getOpenShift(userId);
  const cashWindow = cashierCashWindow(shift, now);

  const today = { gte: startOfStoreDay(now), lte: endOfStoreDay(now) };
  const [shiftSummary, transactionsToday, cashCollected, kpis, recent, out, low, movements, cashOutToday] = await Promise.all([
    shift ? computeShiftSummary(shift.id, shift.openingCash) : null,
    db.sale.count({
      where: {
        userId,
        status: { in: COMPLETED_TRANSACTION_STATUSES },
        createdAt: { gte: startOfStoreDay(now), lte: endOfStoreDay(now) },
      },
    }),
    getCashCollected(userId, cashWindow),
    getInventoryKpis({ now }),
    db.sale.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: RECENT_SALES,
      select: {
        id: true,
        invoiceNumber: true,
        createdAt: true,
        total: true,
        status: true,
        payments: { where: { direction: 'INBOUND' }, select: { method: true } },
      },
    }),
    getStockLevels({ status: 'OUT_OF_STOCK', sort: 'name', page: 1, pageSize: STOCK_ALERTS }),
    getStockLevels({ status: 'LOW_ANY', sort: 'attention', page: 1, pageSize: STOCK_ALERTS }),
    recentCashMovements(userId, RECENT_MOVEMENTS),
    db.cashMovement.aggregate({
      where: { userId, type: 'CASH_OUT', createdAt: today },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    shift,
    shiftSummary,
    cashWindow,
    transactionsToday,
    cashCollected,
    // Tracked products with stock on hand, plus untracked ones (services,
    // fees), which the till sells without counting stock.
    productsAvailable: kpis.inStock + kpis.lowStock + kpis.untrackedProducts,
    lowStockAlerts: kpis.restockRequired,
    outOfStock: kpis.outOfStock,
    recentSales: recent.map((sale) => {
      const methods = [...new Set(sale.payments.map((p) => p.method))];
      return {
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        createdAt: sale.createdAt,
        total: toNum(sale.total),
        status: sale.status,
        paymentMethod: methods.length === 0 ? null : methods.length > 1 ? 'Split' : methods[0],
      };
    }),
    // Out of stock first, then low — and only the fields the panel shows.
    stockAlerts: [...out.rows, ...low.rows].slice(0, STOCK_ALERTS).map((row) => ({
      productId: row.productId,
      name: row.name,
      code: row.barcode ?? row.sku,
      imageUrl: row.imageUrl,
      available: row.available,
      threshold: row.reorderLevel > 0 ? row.reorderLevel : row.minStock,
    })),
    cashMovements: movements,
    cashOutToday: { amount: toNum(money(cashOutToday._sum.amount ?? 0)), count: cashOutToday._count._all },
  };
}

/**
 * Cash actually kept from sales, net of cash refunds: what customers handed
 * over less the change given back, on sales that were not voided. Only CASH
 * counts — a GCash sale put nothing in the drawer — and gross sales are never
 * used. For an open shift this is the shift's own drawer maths.
 */
async function getCashCollected(userId: string, window: CashierCashWindow): Promise<number> {
  const db = await storeDb();
  if (window.kind === 'shift') {
    const shift = await getOpenShift(userId);
    if (!shift) return 0;
    const summary = await computeShiftSummary(shift.id, shift.openingCash);
    return toNum(money(D(summary.cashSales).minus(D(summary.cashRefunds))));
  }

  const inWindow = { gte: window.from, lte: window.to };
  const [tendered, change, refunds] = await Promise.all([
    db.payment.aggregate({
      where: { method: 'CASH', direction: 'INBOUND', sale: { userId, status: { not: 'VOIDED' } }, createdAt: inWindow },
      _sum: { amount: true },
    }),
    db.sale.aggregate({
      where: { userId, status: { not: 'VOIDED' }, createdAt: inWindow },
      _sum: { changeAmount: true },
    }),
    db.payment.aggregate({
      where: { method: 'CASH', direction: 'OUTBOUND', return: { sale: { userId } }, createdAt: inWindow },
      _sum: { amount: true },
    }),
  ]);

  return toNum(
    money(D(tendered._sum.amount ?? 0).minus(D(change._sum.changeAmount ?? 0)).minus(D(refunds._sum.amount ?? 0))),
  );
}
