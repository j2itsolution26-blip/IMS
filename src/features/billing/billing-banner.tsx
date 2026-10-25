import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, Clock, Info, type LucideIcon } from 'lucide-react';
import type { BillingBannerKind } from '@/lib/billing';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  info: 'border-info/30 bg-info/10',
  success: 'border-mint-strong bg-mint',
  warning: 'border-warning/40 bg-warning/10',
  danger: 'border-destructive/30 bg-destructive/10',
};
const ICON_CLASS: Record<Tone, string> = {
  info: 'text-info-text',
  success: 'text-primary',
  warning: 'text-warning-text',
  danger: 'text-destructive-text',
};

export interface BillingBannerProps {
  kind: BillingBannerKind;
  planName: string;
  /** When the trial or paid period ends (grace end while in grace). */
  endsAt: Date | null;
  invoice: { number: string; amount: number; dueAt: Date } | null;
  selfService: boolean;
  /** What the administrator has not published yet: "prices", "billing terms" or both. Null when nothing is missing. */
  unpublished: string | null;
}

/**
 * The one billing message above the plans, from the server's own state
 * (`billingBannerKind`). It never says money is owed unless an invoice is open.
 */
export function BillingBanner({ kind, planName, endsAt, invoice, selfService, unpublished }: BillingBannerProps) {
  const choose = selfService ? 'Choose a plan below' : 'Contact support or pay the administrator directly';
  const due = invoice ? `${formatCurrency(invoice.amount, 'PHP')}, due ${formatDate(invoice.dueAt)}` : '';
  const content: Record<BillingBannerKind, { tone: Tone; icon: LucideIcon; text: string; link?: boolean }> = {
    SUSPENDED: {
      tone: 'danger',
      icon: Ban,
      text: 'The platform administrator suspended this store. Plan changes and payment reports are unavailable. Contact support to resolve it.',
    },
    INVOICE_OVERDUE: {
      tone: 'danger',
      icon: AlertTriangle,
      text: `Invoice ${invoice?.number} (${due}) is overdue. Pay it and report the payment to keep full access.`,
      link: true,
    },
    PAYMENT_PENDING: {
      tone: 'info',
      icon: Clock,
      text: `Your payment for invoice ${invoice?.number} is awaiting verification by the platform administrator. Nothing else is needed for now.`,
      link: true,
    },
    INVOICE_DUE: {
      tone: 'warning',
      icon: Clock,
      text: `Invoice ${invoice?.number} for ${due}. Pay it, then report the payment for verification.`,
      link: true,
    },
    INVOICE_OPEN: {
      tone: 'info',
      icon: Info,
      text: `You chose a plan. Invoice ${invoice?.number} is open: ${due}.`,
      link: true,
    },
    READ_ONLY: {
      tone: 'danger',
      icon: AlertTriangle,
      text: `Your subscription has ended and the store is read-only. No data was removed. ${choose} to restore full access.`,
    },
    GRACE: {
      tone: 'warning',
      icon: Clock,
      text: `Your subscription has ended. The store keeps working until ${endsAt ? formatDate(endsAt) : 'the grace period ends'}, then becomes read-only. ${choose} to keep full access.`,
    },
    PRICING_UNAVAILABLE: {
      tone: 'info',
      icon: Info,
      text: `Self-service plan changes are unavailable until the platform administrator publishes ${unpublished ?? 'prices and billing terms'}. Nothing is owed. You can still pay the administrator directly; they will record it for you.`,
    },
    TRIAL: {
      tone: 'info',
      icon: Info,
      text: `You are on a free ${planName} trial${endsAt ? ` until ${formatDate(endsAt)}` : ''}. Nothing is owed; choose a plan before it ends to keep going.`,
    },
    ACTIVE: {
      tone: 'success',
      icon: CheckCircle2,
      text: `Your ${planName} plan is paid${endsAt ? ` through ${formatDate(endsAt)}` : ''}. Nothing is owed. You can renew early, upgrade or downgrade below.`,
    },
  };
  const { tone, icon: Icon, text, link } = content[kind];
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm', TONE_CLASS[tone])}>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', ICON_CLASS[tone])} aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {text}
        {link && (
          <>
            {' '}
            <Link href="#outstanding-invoice" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              View invoice <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
