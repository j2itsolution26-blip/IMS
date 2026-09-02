import type { SaleStatus } from '@prisma/client';

/** Maps the DB's sale-lifecycle enum onto the labels the spec asks for. */
export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  COMPLETED: 'Paid',
  PARTIALLY_RETURNED: 'Refunded',
  RETURNED: 'Refunded',
  VOIDED: 'Voided',
};

export const SALE_STATUS_BADGE: Record<SaleStatus, 'success' | 'warning' | 'destructive'> = {
  COMPLETED: 'success',
  PARTIALLY_RETURNED: 'warning',
  RETURNED: 'warning',
  VOIDED: 'destructive',
};
