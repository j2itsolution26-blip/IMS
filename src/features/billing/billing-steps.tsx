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
 * administrator verifies the payment. GCash and bank transfer are the
 * methods the payment report accepts.
 */
export function BillingSteps({ paymentInstructions }: { paymentInstructions: string | null }) {
  return (
    <section aria-labelledby="billing-steps-heading" className="rounded-card border bg-gradient-to-r from-mint to-card p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:gap-6">
        <div className="shrink-0 xl:w-52">
          <h2 id="billing-steps-heading" className="text-base font-semibold">
            How billing and payment work
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Nothing is charged automatically, and paying early never loses days.</p>
        </div>
        <ol className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 rounded-xl bg-card/70 p-3 xl:bg-transparent xl:p-0">
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
      <details className="mt-4 rounded-xl border bg-card/70">
        <summary className="cursor-pointer select-none rounded-xl px-3 py-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Payment instructions
        </summary>
        <div className="whitespace-pre-wrap border-t px-3 py-2 text-sm">
          {paymentInstructions ?? (
            <span className="text-muted-foreground">Not published yet. Contact support for the GCash or bank details.</span>
          )}
        </div>
      </details>
    </section>
  );
}
