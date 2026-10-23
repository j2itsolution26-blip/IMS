import * as React from 'react';
import type { ButtonProps } from '@/components/ui/button';
import type { Feature } from '@/lib/plans';
import { upgradeInfoFor } from '@/server/services/plan-ui';
import { LockedButton } from '@/features/subscription/upgrade-dialog';

/**
 * Shows `children` when the store's plan includes `feature`; otherwise a
 * locked stand-in button with the plan badge that opens the upgrade dialog.
 * A server component, so the decision is made from the store's real plan.
 */
export async function PlanGate({
  feature,
  label,
  icon,
  size,
  variant,
  children,
}: {
  feature: Feature;
  label: string;
  icon?: React.ReactNode;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  children: React.ReactNode;
}) {
  const info = await upgradeInfoFor(feature);
  if (!info) return <>{children}</>;
  return <LockedButton label={label} icon={icon} info={info} size={size} variant={variant} />;
}
