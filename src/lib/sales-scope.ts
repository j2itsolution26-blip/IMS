import type { SaleStatus } from '@prisma/client';
import { FINANCIAL_PERMISSION, type PermissionKey } from '@/lib/permissions';

/**
 * Whose sales a signed-in user may read.
 *
 * The owner's financial permission opens every sale in the store. Anyone else
 * who may view sales — a cashier — sees only the sales they rang up: their own
 * receipts, their own totals. Store-wide takings stay the owner's.
 *
 * Kept free of database imports so the rule is unit-tested directly; every
 * sales page, action and API that reads a sale goes through these functions.
 */

export interface SalesViewer {
  id: string;
  permissions: { has: (key: PermissionKey) => boolean };
}

/** Null when the viewer may read every sale; otherwise the only cashier id they may read. */
export function salesScopeUserId(viewer: SalesViewer): string | null {
  return viewer.permissions.has(FINANCIAL_PERMISSION) ? null : viewer.id;
}

/** True when the viewer may open this one sale. */
export function canViewSaleRecord(viewer: SalesViewer, saleUserId: string): boolean {
  const scope = salesScopeUserId(viewer);
  return scope === null || scope === saleUserId;
}

/**
 * The statuses a "completed transaction" count includes. A partly refunded
 * sale still happened; a fully refunded or voided one did not stand.
 */
export const COMPLETED_TRANSACTION_STATUSES: SaleStatus[] = ['COMPLETED', 'PARTIALLY_RETURNED'];
