'use client';

import * as React from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * How a plan restriction is shown: a small "🔒 Business" badge, and a dialog
 * that says what is locked, which plan includes it, and what to do next.
 *
 * Presentation only — the server refuses the action whatever the page shows.
 */

export interface UpgradeInfo {
  /** What the person tried to use, e.g. "Report exports". */
  title: string;
  /** Why it is unavailable and what it would take. */
  description: string;
  /** The cheapest plan that includes it, e.g. "Business". */
  planName: string | null;
  /** Whether this person can open Settings → Subscription. */
  canManageBilling: boolean;
}

export function PlanBadge({ planName, className }: { planName: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning',
        className,
      )}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      {planName ?? 'Upgrade'}
    </span>
  );
}

export function UpgradeDialog({
  open,
  onOpenChange,
  info,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  info: UpgradeInfo;
  /** The button that opened it; focus goes back there on close (the dialog has no Radix trigger). */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-warning" aria-hidden="true" />
            {info.title}
          </DialogTitle>
          <DialogDescription>{info.description}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {info.canManageBilling
            ? 'See your plan, usage and how to upgrade on the Subscription page. Your records are never deleted.'
            : 'Ask the store owner to upgrade the plan. Your records are never deleted.'}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {info.canManageBilling && (
            <Button asChild>
              <Link href="/settings/subscription">View subscription</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Stands in for a control the plan does not include: looks like the real
 * button, carries the plan badge, and opens the upgrade dialog.
 */
export function LockedButton({
  label,
  icon,
  info,
  size,
  variant = 'outline',
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  info: UpgradeInfo;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${label} — ${info.planName ? `available on the ${info.planName} plan` : 'not available on your plan'}`}
      >
        {icon}
        {label}
        <PlanBadge planName={info.planName} />
      </Button>
      <UpgradeDialog open={open} onOpenChange={setOpen} info={info} returnFocusTo={buttonRef} />
    </>
  );
}
