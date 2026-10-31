import type { AuditAction } from '@prisma/client';

/**
 * The store activity log's rules: how far back a plan may look, and the
 * categories an owner filters by. Pure, so the window boundaries are
 * unit-tested directly; src/server/services/audit-queries.ts applies them to
 * every store audit query on the server.
 *
 * The window limits what a store can see. It never deletes anything: every
 * entry is kept (the audit_logs table is append-only), so an upgrade shows
 * the older history again.
 */

const DAY = 86_400_000;

/** The earliest entry a plan keeping `days` of history may see; null = all of it. */
export function auditWindowStart(days: number | null, now: Date = new Date()): Date | null {
  return days === null ? null : new Date(now.getTime() - days * DAY);
}

export type AuditCategory = 'sales' | 'cash' | 'inventory' | 'staff' | 'billing' | 'settings';

/** Each category is the entries with one of these actions, or about one of these entities. */
export const AUDIT_CATEGORIES: Record<AuditCategory, { label: string; actions: AuditAction[]; entities: string[] }> = {
  sales: { label: 'Sales, voids and refunds', actions: ['SALE', 'RETURN'], entities: ['Sale', 'Return'] },
  cash: {
    label: 'Shifts and cash',
    actions: ['CASH_MOVEMENT', 'SHIFT_OPEN', 'SHIFT_CLOSE', 'SHIFT_REVIEW', 'SHIFT_ADJUSTMENT'],
    entities: ['CashierShift', 'CashMovement', 'WalletTransaction'],
  },
  inventory: { label: 'Products and stock', actions: ['INVENTORY_CHANGE', 'PRICE_CHANGE'], entities: ['Product', 'Category', 'Inventory'] },
  staff: { label: 'Staff and roles', actions: ['LOGIN', 'LOGOUT'], entities: ['User', 'Role'] },
  billing: { label: 'Subscription and billing', actions: ['SUBSCRIPTION', 'PAYMENT'], entities: ['Store', 'Invoice', 'SubscriptionPayment', 'Billing'] },
  settings: { label: 'Settings and exports', actions: ['SETTINGS_CHANGE', 'EXPORT'], entities: ['Setting', 'Report', 'DataExport'] },
};

export function parseAuditCategory(value: unknown): AuditCategory | null {
  // Own keys only: "toString" and friends are not categories.
  return typeof value === 'string' && Object.hasOwn(AUDIT_CATEGORIES, value) ? (value as AuditCategory) : null;
}

/** "Sale", "RETURN" → readable words for the action column. */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: 'Sign-in',
  LOGOUT: 'Sign-out',
  CREATE: 'Created',
  UPDATE: 'Changed',
  DELETE: 'Deleted',
  INVENTORY_CHANGE: 'Stock',
  PRICE_CHANGE: 'Price',
  SALE: 'Sale',
  RETURN: 'Refund',
  SETTINGS_CHANGE: 'Settings',
  EXPORT: 'Export',
  SHIFT_OPEN: 'Shift opened',
  SHIFT_CLOSE: 'Shift closed',
  CASH_MOVEMENT: 'Cash',
  SHIFT_REVIEW: 'Shift review',
  SHIFT_ADJUSTMENT: 'Shift adjustment',
  SUBSCRIPTION: 'Subscription',
  PAYMENT: 'Payment',
};

/** How the window reads on the page. */
export function auditWindowLabel(days: number | null): string {
  return days === null ? 'your full history' : `the last ${days} days`;
}
