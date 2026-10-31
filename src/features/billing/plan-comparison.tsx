import { Check, Minus } from 'lucide-react';
import { COMING_SOON, CORE_FEATURES, PLANS, PLAN_ORDER, SUPPORT_LABEL, type PlanDefinition, type PlanId } from '@/lib/plans';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A cell is text, or true / false for included / not included. */
type Cell = string | boolean;

const limit = (value: number | null, unit = '') => (value === null ? 'Unlimited' : `${value === 0 ? '—' : formatNumber(value, 0)}${value ? unit : ''}`);

/**
 * Every row comes from the plan configuration (lib/plans), so the table and
 * the cards can never disagree, and nothing planned is listed as available.
 */
export function comparisonRows(): { group: string; rows: { label: string; value: (plan: PlanDefinition) => Cell }[] }[] {
  return [
    {
      group: 'Capacity',
      rows: [
        { label: 'Locations', value: (p) => limit(p.limits.branches) },
        { label: 'Staff accounts', value: (p) => limit(p.limits.staff) },
        { label: 'Products', value: (p) => limit(p.limits.products) },
      ],
    },
    {
      group: 'Selling and stock',
      rows: CORE_FEATURES.map((label) => ({ label, value: () => true })),
    },
    {
      group: 'Management',
      rows: [
        { label: 'Report exports', value: (p) => p.features.reportExports },
        { label: 'Custom roles and permission editing', value: (p) => p.features.customRoles },
        {
          label: 'Photo background removal',
          value: (p) => (p.features.backgroundRemoval && p.limits.backgroundRemovalsPerMonth ? `${limit(p.limits.backgroundRemovalsPerMonth)} / month` : false),
        },
        { label: 'Audit history', value: (p) => (p.auditHistoryDays === null ? 'Full history' : `${formatNumber(p.auditHistoryDays, 0)} days`) },
        { label: 'Support', value: () => SUPPORT_LABEL },
      ],
    },
    {
      group: 'Coming soon',
      rows: COMING_SOON.map((label) => ({ label, value: () => 'Coming soon' })),
    },
  ];
}

const ACCENT: Record<PlanId, string> = {
  BASIC: 'text-plan-basic-text',
  BUSINESS: 'text-success-text',
  ENTERPRISE: 'text-plan-enterprise-text',
};

function CellValue({ cell, plan }: { cell: Cell; plan: PlanId }) {
  if (cell === true)
    return (
      <>
        <Check className={cn('mx-auto h-4 w-4', ACCENT[plan])} strokeWidth={3} aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    );
  if (cell === false)
    return (
      <>
        <Minus className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  return <span className="tabular font-medium">{cell}</span>;
}

/** The plan-by-plan comparison under the cards. Scrolls sideways on narrow screens, with the feature names kept in view. */
export function PlanComparison({ currentPlan }: { currentPlan: PlanId | null }) {
  return (
    <section aria-labelledby="plan-comparison-title" className="space-y-3">
      <h3 id="plan-comparison-title" className="text-lg font-semibold tracking-tight">
        Compare plans
      </h3>
      <div className="overflow-x-auto rounded-2xl border bg-card/60">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-semibold">
                Feature
              </th>
              {PLAN_ORDER.map((id) => (
                <th key={id} scope="col" className={cn('px-4 py-3 text-center font-semibold', ACCENT[id])} aria-current={id === currentPlan ? 'true' : undefined}>
                  {PLANS[id].name}
                  {id === currentPlan && <span className="block text-[11px] font-medium text-muted-foreground">Your plan</span>}
                </th>
              ))}
            </tr>
          </thead>
          {comparisonRows().map(({ group, rows }) => (
            <tbody key={group}>
              <tr>
                <th scope="colgroup" colSpan={PLAN_ORDER.length + 1} className="bg-muted/40 px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {group}
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-border/60">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-normal text-muted-foreground">
                    {row.label}
                  </th>
                  {PLAN_ORDER.map((id) => (
                    <td key={id} className={cn('px-4 py-3 text-center', id === 'BUSINESS' && 'bg-primary/[0.04]')}>
                      <CellValue cell={row.value(PLANS[id])} plan={id} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What happens to my data if I downgrade?',
    a: 'Nothing is deleted. If you have more products or staff than the new plan allows, everything stays; you just cannot add more until you are under the limit or upgrade again.',
  },
  {
    q: 'How do I pay?',
    a: 'Choosing a plan issues an invoice. Pay it using the payment details shown, upload your receipt, and your plan starts once the payment is verified.',
  },
  {
    q: 'What counts towards the product limit?',
    a: 'Every product that is not archived. Archive products you no longer sell to free up room.',
  },
  {
    q: 'Should I pay monthly or annually?',
    a: 'Annual billing costs less than twelve monthly payments. The saving on each plan is shown on its card when you switch to Annually.',
  },
];

/** A few short answers about billing. Native disclosure elements: keyboard and screen-reader friendly without script. */
export function PlanFaq() {
  return (
    <section aria-labelledby="plan-faq-title" className="space-y-3">
      <h3 id="plan-faq-title" className="text-lg font-semibold tracking-tight">
        Questions
      </h3>
      <div className="divide-y divide-border/60 rounded-2xl border bg-card/60">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {q}
              <span className="text-muted-foreground transition-transform duration-200 group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="pb-1 pt-2 text-sm leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
