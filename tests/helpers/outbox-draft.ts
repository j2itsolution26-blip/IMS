import type { NewOutboxEntry } from '@/features/offline/outbox';

/** A cash sale as the till saves it, for the outbox and sync engine tests. */
export function draft(overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    storeId: 'store_a',
    userId: 'cashier_1',
    createdAt: new Date().toISOString(),
    method: 'CASH',
    route: 'checkout',
    checkout: { items: [{ productId: 'p1', quantity: 1 }], payments: [{ method: 'CASH', amount: 20 }], clientRequestId: id },
    offline: {
      id,
      localReceiptNumber: 'pending',
      occurredAt: new Date().toISOString(),
      catalogFetchedAt: new Date().toISOString(),
      userId: 'cashier_1',
      shiftId: 'shift_1',
      warehouseId: 'wh_1',
      taxRate: 0,
      items: [{ productId: 'p1', quantity: 1, unitPrice: 15, discount: 0 }],
      discount: 0,
      cashTendered: 20,
      total: 15,
    },
    receipt: {
      invoiceNumber: '',
      issuedAt: new Date().toISOString(),
      cashierName: 'Cashier',
      lines: [{ name: 'Soap', quantity: 1, unitPrice: 15, discount: 0, total: 15 }],
      subtotal: 15,
      tax: 0,
      discount: 0,
      total: 15,
      paid: 20,
      change: 5,
      payments: [{ method: 'Cash', amount: 20 }],
      company: { name: 'Store', address: '', phone: '', receiptFooter: '' },
      currency: 'PHP',
    },
    status: 'pending',
    ...overrides,
  };
}
