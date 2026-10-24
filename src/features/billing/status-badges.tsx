import * as React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  INVOICE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type InvoiceDisplayStatus,
  type PaymentDisplayStatus,
} from '@/lib/billing';

/** One set of status colours for invoices and payments, wherever they appear. */

const INVOICE_VARIANT: Record<InvoiceDisplayStatus, BadgeProps['variant']> = {
  OPEN: 'warning',
  AWAITING_VERIFICATION: 'default',
  OVERDUE: 'destructive',
  PAID: 'success',
  VOID: 'outline',
};

const PAYMENT_VARIANT: Record<PaymentDisplayStatus, BadgeProps['variant']> = {
  PENDING: 'default',
  VERIFIED: 'success',
  REJECTED: 'destructive',
  VOID: 'outline',
};

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  return (
    <Badge variant={INVOICE_VARIANT[status]} className={status === 'VOID' ? 'text-muted-foreground' : undefined}>
      {INVOICE_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentDisplayStatus }) {
  return (
    <Badge variant={PAYMENT_VARIANT[status]} className={status === 'VOID' ? 'text-muted-foreground' : undefined}>
      {PAYMENT_STATUS_LABEL[status]}
    </Badge>
  );
}
