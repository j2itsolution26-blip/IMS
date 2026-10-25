import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import type { LimitKey } from '@/lib/plans';
import { ACCESS_LABEL, ACCESS_TONE } from '@/lib/subscription';
import type { AccessState } from '@/lib/store-access';

/**
 * Pieces shared by the owner's Subscription page and the platform's store
 * page. Everything shown comes from the plan configuration and server counts.
 */

export const METER_LABEL: Record<LimitKey, string> = {
  products: 'Products',
  staff: 'Staff accounts',
  branches: 'Branches',
  backgroundRemovalsPerMonth: 'Background removals this month',
};

export const METER_HINT: Partial<Record<LimitKey, string>> = {
  products: 'Archived products do not count.',
  staff: 'Active accounts; the owner does not count.',
};

const TONE_VARIANT = { success: 'success', info: 'default', warning: 'warning', danger: 'destructive' } as const;

export function AccessBadge({ state }: { state: AccessState }) {
  return <Badge variant={TONE_VARIANT[ACCESS_TONE[state]]}>{ACCESS_LABEL[state]}</Badge>;
}
