import {
  Banknote,
  Circle,
  ClockArrowUp,
  CreditCard,
  Download,
  Package,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Undo2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AUDIT_CATEGORY_LABEL, AUDIT_SEVERITY_LABEL, type AuditCategory, type AuditSeverity } from '@/lib/audit-log';
import { cn } from '@/lib/utils';

export const CATEGORY_ICON: Record<AuditCategory, LucideIcon> = {
  security: ShieldCheck,
  sales: ShoppingCart,
  refunds: Undo2,
  shifts: ClockArrowUp,
  cash: Banknote,
  inventory: Package,
  staff: Users,
  settings: Settings2,
  billing: CreditCard,
  exports: Download,
  other: Circle,
};

/** Neutral for every category: colour is kept for severity alone. */
export function CategoryChip({ category, className }: { category: AuditCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 text-sm text-foreground', className)}>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{AUDIT_CATEGORY_LABEL[category]}</span>
    </span>
  );
}

const SEVERITY_CLASS: Record<AuditSeverity, string> = {
  normal: 'text-muted-foreground',
  attention: 'border-transparent bg-warning/15 text-warning-text',
  critical: 'border-transparent bg-destructive/10 text-destructive-text',
};

const SEVERITY_DOT: Record<AuditSeverity, string> = {
  normal: 'bg-muted-foreground/40',
  attention: 'bg-warning',
  critical: 'bg-destructive',
};

/** Routine entries read as plain text; only attention and critical get a pill. */
export function SeverityBadge({ severity, className }: { severity: AuditSeverity; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium',
        severity !== 'normal' && 'rounded-full border px-2 py-0.5',
        SEVERITY_CLASS[severity],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_DOT[severity])} aria-hidden />
      {AUDIT_SEVERITY_LABEL[severity]}
    </span>
  );
}
