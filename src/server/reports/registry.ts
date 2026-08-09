import 'server-only';

import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import type { PermissionKey } from '@/lib/permissions';
import type { DateRange } from '@/server/analytics/date-range';
import { getSalesSummary } from '@/server/analytics/dashboard';
import {
  getSalesBreakdown,
  getSalesTimeSeries,
  getTopCustomers,
  getMostReturnedProducts,
  granularityForRange,
} from '@/server/analytics/sales-analytics';
import {
  getMovementAnalysis,
  getStockLevels,
  getSupplierPerformance,
} from '@/server/analytics/inventory-analytics';

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
  group: 'Sales' | 'Inventory' | 'Purchasing' | 'Finance' | 'System';
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
    description: 'Revenue, profit, and order counts per day, week, or month for the period.',
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
    description: 'Every invoice in the period with its customer, cashier, totals, and profit.',
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
          customer: { select: { name: true } },
          user: { select: { name: true } },
          _count: { select: { items: true } },
        },
      });

      return {
        columns: [
          text('invoice', 'Invoice'),
          { key: 'date', label: 'Date', format: 'datetime' },
          text('customer', 'Customer'),
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
          customer: sale.customer?.name ?? 'Walk-in',
          cashier: sale.user.name,
          lines: sale._count.items,
          total: toNum(sale.total),
          tax: toNum(sale.taxAmount),
          cost: toNum(sale.costOfGoods),
          profit:
            sale.status === 'VOIDED'
              ? 0
              : toNum(sale.total) - toNum(sale.taxAmount) - toNum(sale.costOfGoods),
          status: sale.status,
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
    id: 'best-customers',
    name: 'Customer report',
    description: 'Customers ranked by spend, with order counts and average basket.',
    permission: 'customers.view',
    group: 'Sales',
    usesDateRange: true,
    async load(range) {
      const rows = await getTopCustomers(range.from, range.to, 500);
      return {
        columns: [
          text('name', 'Customer'),
          count('orders', 'Orders'),
          money('revenue', 'Total spent'),
          money('profit', 'Profit generated'),
          money('averageOrderValue', 'Average order'),
          { key: 'lastPurchase', label: 'Last purchase', format: 'date' },
        ],
        rows: rows.map((row) => ({ ...row })),
      };
    },
  },

  // --- Inventory -----------------------------------------------------------
  {
    id: 'inventory',
    name: 'Inventory report',
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
          qty('reorderLevel', 'Reorder level'),
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
          warehouse: { select: { name: true } },
          user: { select: { name: true } },
        },
      });

      return {
        columns: [
          { key: 'date', label: 'Date', format: 'datetime' },
          text('sku', 'SKU'),
          text('product', 'Product'),
          text('warehouse', 'Warehouse'),
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
          warehouse: movement.warehouse.name,
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

  // --- Purchasing ----------------------------------------------------------
  {
    id: 'purchases',
    name: 'Purchase report',
    description: 'Every purchase order raised in the period with receipt and payment status.',
    permission: 'purchases.view',
    group: 'Purchasing',
    usesDateRange: true,
    async load(range) {
      const orders = await prisma.purchaseOrder.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
        select: {
          orderNumber: true,
          createdAt: true,
          expectedDate: true,
          receivedDate: true,
          status: true,
          total: true,
          paidAmount: true,
          supplier: { select: { name: true } },
          warehouse: { select: { name: true } },
        },
      });

      return {
        columns: [
          text('orderNumber', 'Order'),
          { key: 'date', label: 'Raised', format: 'date' },
          text('supplier', 'Supplier'),
          text('warehouse', 'Warehouse'),
          { key: 'expected', label: 'Expected', format: 'date' },
          { key: 'received', label: 'Received', format: 'date' },
          money('total', 'Total'),
          money('paid', 'Paid'),
          money('outstanding', 'Outstanding'),
          text('status', 'Status'),
        ],
        rows: orders.map((order) => ({
          orderNumber: order.orderNumber,
          date: order.createdAt,
          supplier: order.supplier.name,
          warehouse: order.warehouse.name,
          expected: order.expectedDate,
          received: order.receivedDate,
          total: toNum(order.total),
          paid: toNum(order.paidAmount),
          outstanding: Math.max(0, toNum(order.total) - toNum(order.paidAmount)),
          status: order.status,
        })),
      };
    },
  },
  {
    id: 'suppliers',
    name: 'Supplier report',
    description: 'Spend, delivery reliability, and outstanding balances by supplier.',
    permission: 'suppliers.view',
    group: 'Purchasing',
    usesDateRange: true,
    async load(range) {
      const rows = await getSupplierPerformance(range.from, range.to, 500);
      return {
        columns: [
          text('name', 'Supplier'),
          count('orders', 'Orders'),
          count('receivedOrders', 'Received'),
          { key: 'onTimeRate', label: 'On-time rate', format: 'percent', numeric: true },
          { key: 'averageLeadTimeDays', label: 'Avg lead time (days)', format: 'number', numeric: true },
          money('totalSpend', 'Total spend'),
          money('outstandingBalance', 'Outstanding'),
        ],
        rows: rows.map((row) => ({
          name: row.name,
          orders: row.orders,
          receivedOrders: row.receivedOrders,
          onTimeRate: row.onTimeRate,
          averageLeadTimeDays: row.averageLeadTimeDays,
          totalSpend: row.totalSpend,
          outstandingBalance: row.outstandingBalance,
        })),
      };
    },
  },

  // --- Finance -------------------------------------------------------------
  {
    id: 'profit',
    name: 'Profit report',
    description: 'Revenue less cost of goods, returns, and expenses, per period.',
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
          { label: 'Expenses', value: String(summary.expenses) },
          { label: 'Net profit', value: String(summary.netProfit) },
        ],
      };
    },
  },
  {
    id: 'expenses',
    name: 'Expense report',
    description: 'Operating costs recorded in the period, by category.',
    permission: 'expenses.view',
    group: 'Finance',
    usesDateRange: true,
    async load(range) {
      const expenses = await prisma.expense.findMany({
        where: { incurredAt: { gte: range.from, lte: range.to } },
        orderBy: { incurredAt: 'desc' },
        take: 5000,
        select: {
          reference: true,
          incurredAt: true,
          category: true,
          description: true,
          amount: true,
          method: true,
          user: { select: { name: true } },
        },
      });

      return {
        columns: [
          text('reference', 'Reference'),
          { key: 'date', label: 'Date', format: 'date' },
          text('category', 'Category'),
          text('description', 'Description'),
          text('method', 'Method'),
          text('user', 'Recorded by'),
          money('amount', 'Amount'),
        ],
        rows: expenses.map((expense) => ({
          reference: expense.reference,
          date: expense.incurredAt,
          category: expense.category,
          description: expense.description ?? '',
          method: expense.method,
          user: expense.user.name,
          amount: toNum(expense.amount),
        })),
      };
    },
  },

  // --- System --------------------------------------------------------------
  {
    id: 'audit',
    name: 'Audit log',
    description: 'Every recorded action in the period, with the user and IP address.',
    permission: 'audit.view',
    group: 'System',
    usesDateRange: true,
    async load(range) {
      const logs = await prisma.auditLog.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: 10000,
        select: {
          createdAt: true,
          action: true,
          entity: true,
          summary: true,
          ipAddress: true,
          user: { select: { name: true, email: true } },
        },
      });

      return {
        columns: [
          { key: 'date', label: 'When', format: 'datetime' },
          text('action', 'Action'),
          text('entity', 'Entity'),
          text('summary', 'Summary'),
          text('user', 'User'),
          text('ip', 'IP address'),
        ],
        rows: logs.map((log) => ({
          date: log.createdAt,
          action: log.action,
          entity: log.entity,
          summary: log.summary,
          user: log.user ? `${log.user.name} (${log.user.email})` : 'System',
          ip: log.ipAddress ?? '',
        })),
      };
    },
  },
];

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((report) => report.id === id);
}
