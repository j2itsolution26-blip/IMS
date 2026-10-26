import * as React from 'react';
import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, TimerOff, XCircle, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  INVOICE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type InvoiceDisplayStatus,
  type PaymentDisplayStatus,
} from '@/lib/billing';

/**
 * One set of status colours for invoices and payments, wherever they appear:
 * unpaid neutral, pending verification amber, paid green, rejected red,
 * expired muted red, void grey. Each also has its own icon and label, so the
 * status never depends on colour alone.
 */

type Look = { variant: BadgeProps['variant']; icon: LucideIcon; className?: string };

const INVOICE_LOOK: Record<InvoiceDisplayStatus, Look> = {
  OPEN: { variant: 'secondary', icon: Circle },
  AWAITING_VERIFICATION: { variant: 'warning', icon: Clock },
  OVERDUE: { variant: 'destructive', icon: AlertTriangle },
  EXPIRED: { variant: 'outline', icon: TimerOff, className: 'border-destructive/40 text-destructive-text' },
  PAID: { variant: 'success', icon: CheckCircle2 },
  VOID: { variant: 'outline', icon: Ban, className: 'text-muted-foreground' },
};

const PAYMENT_LOOK: Record<PaymentDisplayStatus, Look> = {
  PENDING: { variant: 'warning', icon: Clock },
  VERIFIED: { variant: 'success', icon: CheckCircle2 },
  REJECTED: { variant: 'destructive', icon: XCircle },
  VOID: { variant: 'outline', icon: Ban, className: 'text-muted-foreground' },
};

function StatusBadge({ look, label }: { look: Look; label: string }) {
  const Icon = look.icon;
  return (
    <Badge variant={look.variant} className={look.className}>
      <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  return <StatusBadge look={INVOICE_LOOK[status]} label={INVOICE_STATUS_LABEL[status]} />;
}

export function PaymentStatusBadge({ status }: { status: PaymentDisplayStatus }) {
  return <StatusBadge look={PAYMENT_LOOK[status]} label={PAYMENT_STATUS_LABEL[status]} />;
}
