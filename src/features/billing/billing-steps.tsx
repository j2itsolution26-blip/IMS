import * as React from 'react';
import { ArrowRight, BadgeCheck, FileText, Mail, Wallet, type LucideIcon } from 'lucide-react';

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: FileText, title: 'Choose a plan', body: 'Pick the plan that fits your store and accept the billing terms.' },
  { icon: Mail, title: 'Receive invoice', body: 'An invoice is issued with the amount, due date and payment instructions.' },
  { icon: Wallet, title: 'Pay via GCash or bank', body: 'Send the payment, then report its reference number on the invoice.' },
  { icon: BadgeCheck, title: 'Admin verifies payment', body: 'The platform administrator checks it and starts or renews your plan.' },
];

/**
 * How paying works, in the order it happens. Mirrors the billing service:
 * choosing a plan only issues an invoice; nothing starts until the
 * administrator verifies the payment. Shown while no invoice is open; with
 * one, the invoice section carries the same steps with the real accounts.
 */
export function BillingSteps() {
  return (
    <section aria-labelledby="billing-steps-heading" className="rounded-card border bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:gap-6">
        <div className="shrink-0 xl:w-52">
          <h2 id="billing-steps-heading" className="text-base font-semibold">
            How billing and payment work
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Nothing is charged automatically, and paying early never loses days.</p>
        </div>
        <ol className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 rounded-xl bg-muted/30 p-3 xl:bg-transparent xl:p-0">
              <span className="relative shrink-0">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-primary shadow-xs ring-1 ring-mint-strong">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {index + 1}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.body}</p>
              </div>
              {index < STEPS.length - 1 && (
                <ArrowRight className="mt-3 hidden h-4 w-4 shrink-0 text-muted-foreground/60 xl:block" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
