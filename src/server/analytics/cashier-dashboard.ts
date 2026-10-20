import 'server-only';

import type { PaymentMethod, Prisma, SaleStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { D, money, toNum } from '@/lib/decimal';
import { endOfStoreDay, startOfStoreDay } from '@/lib/store-time';
import { COMPLETED_TRANSACTION_STATUSES } from '@/lib/sales-scope';
import { cashierCashWindow, type CashierCashWindow } from '@/lib/cashier-window';
import { getOpenShift, type OpenShiftSummary } from '@/server/services/shift-service';
import { getInventoryKpis } from '@/server/analytics/inventory-dashboard';
import { getStockLevels } from '@/server/analytics/inventory-analytics';

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
  cashWindow: CashierCashWindow;
  transactionsToday: number;
  cashCollected: number;
  productsAvailable: number;
  lowStockAlerts: number;
  outOfStock: number;
  recentSales: CashierRecentSale[];
  stockAlerts: CashierStockAlert[];
}

const RECENT_SALES = 8;
const STOCK_ALERTS = 8;

export async function getCashierDashboard(userId: string, now: Date = new Date()): Promise<CashierDashboardData> {
  const shift = await getOpenShift(userId);
  const cashWindow = cashierCashWindow(shift, now);

  const [transactionsToday, cashCollected, kpis, recent, out, low] = await Promise.all([
    prisma.sale.count({
      where: {
        userId,
        status: { in: COMPLETED_TRANSACTION_STATUSES },
        createdAt: { gte: startOfStoreDay(now), lte: endOfStoreDay(now) },
      },
    }),
    getCashCollected(userId, cashWindow),
    getInventoryKpis({ now }),
    prisma.sale.findMany({
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
  ]);

  return {
    shift,
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
  };
}

/**
 * Cash actually taken in, net of cash handed back on refunds.
 *
 * Only CASH payments count — GCash and card are not in the drawer — and a
 * voided sale's payment is left out, since that sale did not stand. Gross
 * sales are deliberately not used: a sale paid by GCash collected no cash.
 */
async function getCashCollected(userId: string, window: CashierCashWindow): Promise<number> {
  const saleScope: Prisma.SaleWhereInput =
    window.kind === 'shift' ? { shiftId: window.shiftId } : { userId };
  const timeScope: Prisma.PaymentWhereInput =
    window.kind === 'shift' ? {} : { createdAt: { gte: window.from, lte: window.to } };

  const [cashIn, cashOut] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        method: 'CASH',
        direction: 'INBOUND',
        sale: { ...saleScope, status: { not: 'VOIDED' } },
        ...timeScope,
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { method: 'CASH', direction: 'OUTBOUND', return: { sale: saleScope }, ...timeScope },
      _sum: { amount: true },
    }),
  ]);

  return toNum(money(D(cashIn._sum.amount ?? 0).minus(D(cashOut._sum.amount ?? 0))));
}
