'use client';

import * as React from 'react';
import { Check, Clock, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PLANS, type PlanId } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { planReason } from '@/features/billing/plan-reasons';

/**
 * Accents for the explanation dialog: neutral for Basic, emerald for
 * Business, purple for Enterprise. Always drawn dark, like the pricing page.
 */
const ACCENT: Record<PlanId, { bar: string; chip: string; check: string }> = {
  BASIC: { bar: 'bg-slate-400/70', chip: 'bg-white/10 text-slate-200', check: 'text-slate-300' },
  BUSINESS: { bar: 'bg-emerald-400', chip: 'bg-emerald-400/15 text-emerald-300', check: 'text-emerald-300' },
  ENTERPRISE: { bar: 'bg-plan-enterprise', chip: 'bg-plan-enterprise/20 text-violet-200', check: 'text-violet-300' },
};

/**
 * The small "Why choose this plan?" button on a plan card, and the dialog it
 * opens. Stays on the pricing page; Escape, the close button or a click
 * outside closes it, and focus returns to the button.
 */
export function PlanWhyButton({ plan: id }: { plan: PlanId }) {
  const plan = PLANS[id];
  const reason = planReason(id);
  const accent = ACCENT[id];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mx-auto flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Why choose this plan?
          <span className="sr-only"> ({plan.name})</span>
        </button>
      </DialogTrigger>
      <DialogContent className="dark max-w-md overflow-hidden border-white/10 bg-[#0b1426] p-0 text-foreground shadow-2xl [color-scheme:dark]">
        <div className={cn('h-1 w-full', accent.bar)} aria-hidden="true" />
        <div className="space-y-4 p-5 sm:p-6">
          <DialogHeader className="space-y-2 pr-6">
            <span className={cn('w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold', accent.chip)}>{plan.name}</span>
            <DialogTitle className="text-lg leading-snug">Why choose {plan.name}?</DialogTitle>
            <DialogDescription className="text-sm font-medium text-slate-200">{reason.headline}</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-slate-300">{reason.summary}</p>
          <ul className="space-y-2 text-sm" aria-label={`${plan.name} key benefits`}>
            {reason.benefits.map((benefit) => (
              <li key={benefit.text} className={cn('flex items-start gap-2.5', benefit.soon && 'text-slate-400')}>
                {benefit.soon ? (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Check className={cn('mt-0.5 h-4 w-4 shrink-0', accent.check)} strokeWidth={3} aria-hidden="true" />
                )}
                <span>
                  {benefit.text}
                  {benefit.soon && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-300">Coming soon</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
