import 'server-only';

import type { PrismaClient } from '@prisma/client';
import { toNum } from '@/lib/decimal';
import { DATA_EXPORT_ROW_LIMIT, salesExportStart, type DataExportDataset } from '@/lib/data-export';
import type { ReportColumn, ReportResult } from '@/server/reports/registry';

/**
 * Builds the rows for "Download your data". Takes the store-scoped client,
 * so only the signed-in user's store is ever read. Cost figures are included
 * only for someone holding the financial permission; staff emails, IP
 * addresses and other accounts' details are never included.
 */

const text = (key: string, label: string): ReportColumn => ({ key, label, format: 'text' });
const money = (key: string, label: string): ReportColumn => ({ key, label, format: 'currency', numeric: true });
const qty = (key: string, label: string): ReportColumn => ({ key, label, format: 'number', numeric: true });

export interface DataExportResult {
  result: ReportResult;
  /** True when there were more rows than one download carries. */
  truncated: boolean;
}

async function productsExport(db: PrismaClient, includeCost: boolean): Promise<DataExportResult> {
  const products = await db.product.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: DATA_EXPORT_ROW_LIMIT + 1,
    select: {
      sku: true,
      barcode: true,
      name: true,
      status: true,
      unit: true,
      sellingPrice: true,
      costPrice: true,
      reorderLevel: true,
      category: { select: { name: true } },
      inventory: { select: { quantity: true } },
    },
  });
  const truncated = products.length > DATA_EXPORT_ROW_LIMIT;
  const columns: ReportColumn[] = [
    text('sku', 'SKU'),
    text('barcode', 'Barcode'),
    text('name', 'Name'),
    text('category', 'Category'),
    text('unit', 'Unit'),
    money('sellingPrice', 'Selling price'),
    ...(includeCost ? [money('costPrice', 'Cost price')] : []),
    qty('onHand', 'Stock on hand'),
    qty('reorderLevel', 'Low-stock level'),
    text('status', 'Status'),
  ];
  const rows = products.slice(0, DATA_EXPORT_ROW_LIMIT).map((product) => ({
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    category: product.category.name,
    unit: product.unit,
    sellingPrice: toNum(product.sellingPrice),
    ...(includeCost ? { costPrice: toNum(product.costPrice) } : {}),
    onHand: product.inventory.reduce((sum, row) => sum + toNum(row.quantity), 0),
    reorderLevel: toNum(product.reorderLevel),
    status: product.status,
  }));
  return { result: { columns, rows }, truncated };
}

async function salesExport(db: PrismaClient, includeCost: boolean, now: Date): Promise<DataExportResult> {
  const sales = await db.sale.findMany({
    where: { createdAt: { gte: salesExportStart(now), lte: now } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: DATA_EXPORT_ROW_LIMIT + 1,
    select: {
      invoiceNumber: true,
      createdAt: true,
      status: true,
      subtotal: true,
      discount: true,
      total: true,
      costOfGoods: true,
      user: { select: { name: true } },
      payments: { where: { direction: 'INBOUND' }, select: { method: true } },
      _count: { select: { items: true } },
    },
  });
  const truncated = sales.length > DATA_EXPORT_ROW_LIMIT;
  const columns: ReportColumn[] = [
    text('invoice', 'Invoice'),
    { key: 'date', label: 'Date', format: 'datetime' },
    text('status', 'Status'),
    text('cashier', 'Cashier'),
    text('methods', 'Payment methods'),
    qty('lines', 'Line items'),
    money('subtotal', 'Subtotal'),
    money('discount', 'Discount'),
    money('total', 'Total'),
    ...(includeCost ? [money('costOfGoods', 'Cost of goods')] : []),
  ];
  const rows = sales.slice(0, DATA_EXPORT_ROW_LIMIT).map((sale) => ({
    invoice: sale.invoiceNumber,
    date: sale.createdAt,
    status: sale.status,
    cashier: sale.user.name,
    methods: [...new Set(sale.payments.map((payment) => payment.method))].join(' + '),
    lines: sale._count.items,
    subtotal: toNum(sale.subtotal),
    discount: toNum(sale.discount),
    total: toNum(sale.total),
    ...(includeCost ? { costOfGoods: toNum(sale.costOfGoods) } : {}),
  }));
  return { result: { columns, rows }, truncated };
}

export function buildDataExport(
  db: PrismaClient,
  dataset: DataExportDataset,
  options: { includeCost: boolean; now?: Date },
): Promise<DataExportResult> {
  return dataset === 'products' ? productsExport(db, options.includeCost) : salesExport(db, options.includeCost, options.now ?? new Date());
}
