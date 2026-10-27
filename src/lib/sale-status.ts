import type { SaleStatus } from '@prisma/client';

/**
 * Maps the DB's sale-lifecycle enum onto the labels every screen and export
 * uses. A partly refunded sale still stands (its refund is netted off
 * separately); a voided one never counts as revenue.
 */
export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  COMPLETED: 'Paid',
  PARTIALLY_RETURNED: 'Partly refunded',
  RETURNED: 'Refunded',
  VOIDED: 'Voided',
};

export const SALE_STATUS_BADGE: Record<SaleStatus, 'success' | 'warning' | 'destructive'> = {
  COMPLETED: 'success',
  PARTIALLY_RETURNED: 'warning',
  RETURNED: 'warning',
  VOIDED: 'destructive',
};
