import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  CATEGORY_INFO,
  PRIORITY_INFO,
  STATUS_INFO,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
  type SupportTone,
} from '@/lib/support';

const VARIANT: Record<SupportTone, NonNullable<BadgeProps['variant']>> = {
  primary: 'default',
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
  muted: 'secondary',
};

export function StatusBadge({ status, audience = 'requester' }: { status: SupportStatus; audience?: 'requester' | 'admin' }) {
  const info = STATUS_INFO[status];
  // "Waiting for you" reads wrong in the administrators' inbox.
  const label = audience === 'admin' && status === 'WAITING_FOR_USER' ? 'Waiting for user' : info.label;
  return <Badge variant={VARIANT[info.tone]}>{label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: SupportPriority }) {
  const info = PRIORITY_INFO[priority];
  return <Badge variant={VARIANT[info.tone]}>{info.label}</Badge>;
}

export function categoryLabel(category: SupportCategory): string {
  return CATEGORY_INFO[category].label;
}
