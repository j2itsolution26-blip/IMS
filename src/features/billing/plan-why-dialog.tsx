'use client';

import * as React from 'react';
import { ArrowUpRight, Check, Clock, HelpCircle, MapPin } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PLANS, type PlanId } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { planReason, type PlanBenefit } from '@/features/billing/plan-reasons';

/** Accents for the explanation: blue for Basic, emerald for Business, violet for Enterprise. Always drawn dark, like the pricing section. */
const ACCENT: Record<PlanId, { bar: string; chip: string; check: string }> = {
  BASIC: { bar: 'bg-blue-500', chip: 'bg-blue-500/15 text-blue-200', check: 'text-blue-300' },
  BUSINESS: { bar: 'bg-emerald-400', chip: 'bg-emerald-400/15 text-emerald-200', check: 'text-emerald-300' },
  ENTERPRISE: { bar: 'bg-violet-500', chip: 'bg-violet-500/20 text-violet-200', check: 'text-violet-300' },
};

/**
 * The small "Why Basic?" button on a plan card, and the dialog it opens.
 * Stays on the pricing page; Escape, the close button or a click outside
 * closes it, and focus returns to the button.
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
          className="mx-auto flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Why {plan.name}?
        </button>
      </DialogTrigger>
      <DialogContent className="dark max-w-md overflow-hidden border-white/10 bg-[#141518] p-0 text-zinc-100 shadow-2xl [color-scheme:dark]">
        <div className={cn('h-1 w-full', accent.bar)} aria-hidden="true" />
        <div className="max-h-[calc(100dvh-6rem)] space-y-5 overflow-y-auto p-5 scrollbar-thin sm:p-6">
          <DialogHeader className="space-y-2 pr-6 text-left">
            <span className={cn('w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold', accent.chip)}>{plan.name}</span>
            <DialogTitle className="text-lg leading-snug text-white">Why {plan.name}?</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-300">{reason.headline}</DialogDescription>
          </DialogHeader>

          <p className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-zinc-200">
            <MapPin className={cn('mt-0.5 h-4 w-4 shrink-0', accent.check)} aria-hidden="true" />
            {reason.locationNote}
          </p>

          <Section title="What it allows" items={reason.limits} check={accent.check} />
          <Section title="Day to day" items={reason.benefits} check={accent.check} />

          {reason.versus && reason.versus.gains.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">More than {reason.versus.name}</h3>
              <ul className="space-y-2 text-sm">
                {reason.versus.gains.map((gain) => (
                  <li key={gain} className="flex items-start gap-2.5">
                    <ArrowUpRight className={cn('mt-0.5 h-4 w-4 shrink-0', accent.check)} aria-hidden="true" />
                    <span>{gain}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, items, check }: { title: string; items: PlanBenefit[]; check: string }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">{title}</h3>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.text} className={cn('flex items-start gap-2.5', item.soon && 'text-zinc-400')}>
            {item.soon ? (
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Check className={cn('mt-0.5 h-4 w-4 shrink-0', check)} strokeWidth={3} aria-hidden="true" />
            )}
            <span>
              {item.text}
              {item.soon && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">Coming soon</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
