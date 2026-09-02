import 'server-only';

import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import type { PermissionKey } from '@/lib/permissions';
import type { DateRange } from '@/server/analytics/date-range';
import { getSalesSummary, getProductPerformance } from '@/server/analytics/dashboard';
import {
  getSalesBreakdown,
  getSalesTimeSeries,
  getMostReturnedProducts,
  getPaymentMethodBreakdown,
  granularityForRange,
} from '@/server/analytics/sales-analytics';
import { getMovementAnalysis, getStockLevels } from '@/server/analytics/inventory-analytics';
import { SALE_STATUS_LABEL } from '@/lib/sale-status';

/**
 * The report catalogue.
 *
 * One definition per report drives the on-screen table, the CSV, the Excel
 * workbook, and the PDF — so a column added here appears everywhere at once and
 * the export can never drift from what the user was looking at.
 *
 * Every `load` runs real queries. There is no cached or precomputed layer.
 */

export type ColumnFormat = 'text' | 'number' | 'quantity' | 'currency' | 'percent' | 'date' | 'datetime';

export interface ReportColumn {
  key: string;
  label: string;
  format: ColumnFormat;
  /** Right-aligns and adds a total row in exports. */
  numeric?: boolean;
  /** Summed in the totals row. */
  total?: boolean;
}

export type ReportRow = Record<string, string | number | Date | null>;

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Headline figures rendered above the table. */
  summary?: { label: string; value: string }[];
}

export interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  permission: PermissionKey;
  group: 'Sales' | 'Inventory' | 'Finance';
  /** False for reports that describe current state rather than a window. */
  usesDateRange: boolean;
  load: (range: DateRange, currency: string) => Promise<ReportResult>;
}

const money = (key: string, label: string): ReportColumn => ({
  key,
  label,
  format: 'currency',
  numeric: true,
  total: true,
});

const count = (key: string, label: string): ReportColumn => ({
  key,
  label,
  format: 'number',
  numeric: true,
  total: true,
});

const qty = (key: string, label: string): ReportColumn => ({
  key,
  label,
  format: 'quantity',
  numeric: true,
  total: true,
});

const text = (key: string, label: string): ReportColumn => ({ key, label, format: 'text' });

export const REPORTS: ReportDefinition[] = [
  // --- Sales ---------------------------------------------------------------
  {
    id: 'sales-summary',
    name: 'Sales summary',
    description: 'Revenue, profit, and order counts per day, week, or month for the period — covers daily, weekly, and monthly sales.',
    permission: 'reports.view',
    group: 'Sales',
    usesDateRange: true,
    async load(range) {
      const [points, summary] = await Promise.all([
        getSalesTimeSeries(range.from, range.to, granularityForRange(range.from, range.to)),
        getSalesSummary(range.from, range.to),
      ]);

      return {
        columns: [
          text('label', 'Period'),
          money('revenue', 'Revenue'),
          money('profit', 'Gross profit'),
          count('orders', 'Orders'),
          qty('units', 'Units sold'),
        ],
        rows: points.map((point) => ({
          label: point.label,
          revenue: point.revenue,
          profit: point.profit,
          orders: point.orders,
          units: point.units,
        })),
        summary: [
          { label: 'Revenue', value: String(summary.revenue) },
          { label: 'Gross profit', value: String(summary.grossProfit) },
          { label: 'Net profit', value: String(summary.netProfit) },
          { label: 'Transactions', value: String(summary.transactionCount) },
        ],
      };
    },
  },
  {
    id: 'sales-detail',
    name: 'Sales detail',
    description: 'Every invoice in the period with its cashier, totals, and profit.',
    permission: 'sales.view',
    group: 'Sales',
    usesDateRange: true,
    async load(range) {
      const sales = await prisma.sale.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
        select: {
          invoiceNumber: true,
          createdAt: true,
          status: true,
          total: true,
          taxAmount: true,
          discount: true,
          costOfGoods: true,
          paidAmount: true,
          user: { select: { name: true } },
          _count: { select: { items: true } },
        },
      });

      return {
        columns: [
          text('invoice', 'Invoice'),
          { key: 'date', label: 'Date', format: 'datetime' },
          text('cashier', 'Cashier'),
          count('lines', 'Lines'),
          money('total', 'Total'),
          money('tax', 'Tax'),
          money('cost', 'Cost of goods'),
          money('profit', 'Profit'),
          text('status', 'Status'),
        ],
        rows: sales.map((sale) => ({
          invoice: sale.invoiceNumber,
          date: sale.createdAt,
          cashier: sale.user.name,
          lines: sale._count.items,
          total: toNum(sale.total),
          tax: toNum(sale.taxAmount),
          cost: toNum(sale.costOfGoods),
          profit:
            sale.status === 'VOIDED'
              ? 0
              : toNum(sale.total) - toNum(sale.taxAmount) - toNum(sale.costOfGoods),
          status: SALE_STATUS_LABEL[sale.status],
        })),
      };
    },
  },
  {
    id: 'sales-by-category',
    name: 'Sales by category',
    description: 'Revenue, profit, and units split by product category.',
    permission: 'reports.view',
    group: 'Sales',
    usesDateRange: true,
    async load(range) {
      const rows = await getSalesBreakdown('category', range.from, range.to, 100);
      return {
        columns: [
          text('label', 'Category'),
          money('revenue', 'Revenue'),
          money('profit', 'Profit'),
          qty('units', 'Units'),
          count('orders', 'Orders'),
          { key: 'share', label: 'Share', format: 'percent', numeric: true },
        ],
        rows: rows.map((row) => ({ ...row })),
      };
    },
  },
  {
    id: 'best-selling',
    name: 'Best selling products',
    description: 'Top products by units sold in the period.',
    permission: 'reports.view',
    group: 'Sales',
    usesDateRange: true,
    async load(range) {
      const rows = await getProductPerformance({ from: range.from, to: range.to, sort: 'units', direction: 'desc', limit: 100 });
      return {
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          text('categoryName', 'Category'),
          qty('unitsSold', 'Units sold'),
          money('revenue', 'Revenue'),
          money('profit', 'Profit'),
          { key: 'marginPercent', label: 'Margin', format: 'percent', numeric: true },
        ],
        rows: rows.map((row) => ({ ...row })),
      };
    },
  },
  {
    id: 'sales-by-payment-method',
    name: 'Sales by payment method',
    description: 'Takings split by cash, GCash, card, and other payment methods.',
    permission: 'reports.view',
    group: 'Sales',
    usesDateRange: true,
    async load(range) {
      const rows = await getPaymentMethodBreakdown(range.from, range.to);
      return {
        columns: [
          text('method', 'Method'),
          money('amount', 'Amount'),
          count('count', 'Payments'),
          { key: 'share', label: 'Share', format: 'percent', numeric: true },
        ],
        rows: rows.map((row) => ({ ...row })),
      };
    },
  },

  // --- Inventory -----------------------------------------------------------
  {
    id: 'inventory',
    name: 'Stock report',
    description: 'Current stock levels and value for every active product.',
    permission: 'inventory.view',
    group: 'Inventory',
    usesDateRange: false,
    async load() {
      const result = await getStockLevels({ pageSize: 200, page: 1, status: 'ALL' });

      // Page through so the export covers the whole catalogue, not just page one.
      const all = [...result.rows];
      for (let page = 2; page <= result.pageCount && page <= 50; page += 1) {
        const next = await getStockLevels({ pageSize: 200, page, status: 'ALL' });
        all.push(...next.rows);
      }

      return {
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          text('categoryName', 'Category'),
          qty('onHand', 'On hand'),
          qty('reserved', 'Reserved'),
          qty('available', 'Available'),
          qty('reorderLevel', 'Low-stock level'),
          money('costPrice', 'Unit cost'),
          money('stockValue', 'Stock value'),
          text('status', 'Status'),
        ],
        rows: all.map((row) => ({
          sku: row.sku,
          name: row.name,
          categoryName: row.categoryName,
          onHand: row.onHand,
          reserved: row.reserved,
          available: row.available,
          reorderLevel: row.reorderLevel,
          costPrice: row.costPrice,
          stockValue: row.stockValue,
          status: row.status,
        })),
      };
    },
  },
  {
    id: 'low-stock',
    name: 'Low stock report',
    description: 'Everything at or below its low-stock level, plus anything out of stock.',
    permission: 'inventory.view',
    group: 'Inventory',
    usesDateRange: false,
    async load() {
      const [low, out] = await Promise.all([
        getStockLevels({ pageSize: 500, page: 1, status: 'LOW' }),
        getStockLevels({ pageSize: 500, page: 1, status: 'OUT_OF_STOCK' }),
      ]);
      const rows = [...out.rows, ...low.rows];

      return {
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          text('categoryName', 'Category'),
          qty('onHand', 'On hand'),
          qty('reorderLevel', 'Low-stock level'),
          text('status', 'Status'),
        ],
        rows: rows.map((row) => ({
          sku: row.sku,
          name: row.name,
          categoryName: row.categoryName,
          onHand: row.onHand,
          reorderLevel: row.reorderLevel,
          status: row.status,
        })),
      };
    },
  },
  {
    id: 'inventory-movement',
    name: 'Inventory movement',
    description: 'Every stock movement in the period with running balances.',
    permission: 'inventory.view',
    group: 'Inventory',
    usesDateRange: true,
    async load(range) {
      const movements = await prisma.inventoryTransaction.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: 10000,
        select: {
          createdAt: true,
          type: true,
          quantity: true,
          balanceAfter: true,
          unitCost: true,
          note: true,
          product: { select: { name: true, sku: true } },
          user: { select: { name: true } },
        },
      });

      return {
        columns: [
          { key: 'date', label: 'Date', format: 'datetime' },
          text('sku', 'SKU'),
          text('product', 'Product'),
          text('type', 'Type'),
          qty('quantity', 'Change'),
          qty('balance', 'Balance after'),
          money('value', 'Value'),
          text('user', 'By'),
        ],
        rows: movements.map((movement) => ({
          date: movement.createdAt,
          sku: movement.product.sku,
          product: movement.product.name,
          type: movement.type,
          quantity: toNum(movement.quantity),
          balance: toNum(movement.balanceAfter),
          value: Math.abs(toNum(movement.quantity)) * toNum(movement.unitCost),
          user: movement.user?.name ?? 'System',
        })),
      };
    },
  },
  {
    id: 'dead-stock',
    name: 'Dead stock',
    description: 'Products holding stock that have not sold within the dead-stock threshold.',
    permission: 'reports.view',
    group: 'Inventory',
    usesDateRange: false,
    async load() {
      const rows = await getMovementAnalysis('DEAD', 500);
      return {
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          qty('onHand', 'On hand'),
          money('stockValue', 'Capital tied up'),
          { key: 'daysSinceLastSale', label: 'Days since last sale', format: 'number', numeric: true },
        ],
        rows: rows.map((row) => ({
          sku: row.sku,
          name: row.name,
          onHand: row.onHand,
          stockValue: row.stockValue,
          daysSinceLastSale: row.daysSinceLastSale,
        })),
      };
    },
  },
  {
    id: 'fast-moving',
    name: 'Fast moving',
    description: 'Your quickest sellers by units in the forecast window.',
    permission: 'reports.view',
    group: 'Inventory',
    usesDateRange: false,
    async load() {
      const rows = await getMovementAnalysis('FAST', 200);
      return {
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          qty('unitsSold', 'Units sold'),
          { key: 'dailyVelocity', label: 'Units per day', format: 'quantity', numeric: true },
          qty('onHand', 'On hand'),
          money('stockValue', 'Stock value'),
        ],
        rows: rows.map((row) => ({ ...row })),
      };
    },
  },
  {
    id: 'slow-moving',
    name: 'Slow moving',
    description: 'Stocked products that have sold at some point, but not recently.',
    permission: 'reports.view',
    group: 'Inventory',
    usesDateRange: false,
    async load() {
      const rows = await getMovementAnalysis('SLOW', 500);
      return {
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          qty('onHand', 'On hand'),
          money('stockValue', 'Stock value'),
          { key: 'daysSinceLastSale', label: 'Days since last sale', format: 'number', numeric: true },
        ],
        rows: rows.map((row) => ({
          sku: row.sku,
          name: row.name,
          onHand: row.onHand,
          stockValue: row.stockValue,
          daysSinceLastSale: row.daysSinceLastSale,
        })),
      };
    },
  },
  {
    id: 'most-returned',
    name: 'Most returned products',
    description: 'Return volumes and rates by product.',
    permission: 'reports.view',
    group: 'Inventory',
    usesDateRange: true,
    async load(range) {
      const rows = await getMostReturnedProducts(range.from, range.to, 200);
      return {
        columns: [
          text('sku', 'SKU'),
          text('name', 'Product'),
          qty('unitsReturned', 'Returned'),
          qty('unitsSold', 'Sold'),
          { key: 'returnRate', label: 'Return rate', format: 'percent', numeric: true },
          money('refundValue', 'Refunded'),
        ],
        rows: rows.map((row) => ({ ...row })),
      };
    },
  },

  // --- Finance -------------------------------------------------------------
  {
    id: 'profit',
    name: 'Profit report',
    description: 'Revenue less cost of goods and returns, per period.',
    permission: 'reports.view',
    group: 'Finance',
    usesDateRange: true,
    async load(range) {
      const [points, summary] = await Promise.all([
        getSalesTimeSeries(range.from, range.to, granularityForRange(range.from, range.to)),
        getSalesSummary(range.from, range.to),
      ]);

      return {
        columns: [
          text('label', 'Period'),
          money('revenue', 'Revenue'),
          money('profit', 'Gross profit'),
          { key: 'margin', label: 'Margin', format: 'percent', numeric: true },
        ],
        rows: points.map((point) => ({
          label: point.label,
          revenue: point.revenue,
          profit: point.profit,
          margin: point.revenue > 0 ? Number(((point.profit / point.revenue) * 100).toFixed(2)) : 0,
        })),
        summary: [
          { label: 'Revenue', value: String(summary.revenue) },
          { label: 'Cost of goods', value: String(summary.costOfGoods) },
          { label: 'Gross profit', value: String(summary.grossProfit) },
          { label: 'Returns', value: String(summary.returnsTotal) },
          { label: 'Net profit', value: String(summary.netProfit) },
        ],
      };
    },
  },
];

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((report) => report.id === id);
}
