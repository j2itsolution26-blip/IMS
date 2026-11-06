import { Check, ChevronDown, Minus } from 'lucide-react';
import { COMING_SOON, PLANS, PLAN_ORDER, SUPPORT_LABEL, staffSlotSummary, type PlanDefinition, type PlanId } from '@/lib/plans';
import { planPricing, type BillingInterval } from '@/lib/billing';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A cell is text, or true / false for included / not included. */
type Cell = string | boolean;

type Price = { plan: PlanId; interval: BillingInterval; amount: number };

const limit = (value: number | null, unit = '') => (value === null ? 'Unlimited' : `${value === 0 ? '—' : formatNumber(value, 0)}${value ? unit : ''}`);

const priceCell = (amount: number | null): Cell => (amount === null ? 'Not published' : formatCurrency(amount, 'PHP'));

const multiBranch = (p: PlanDefinition) => p.limits.branches === null || p.limits.branches > 1;

/**
 * Every row comes from the plan configuration (lib/plans) and the published
 * price list, so the table and the cards can never disagree, and nothing
 * planned is listed as available. Features every plan has are true for all.
 */
export function comparisonRows(prices: Price[] = []): { group: string; rows: { label: string; value: (plan: PlanDefinition) => Cell }[] }[] {
  const annualPublished = prices.some((price) => price.interval === 'ANNUAL' && price.amount > 0);
  const everyPlan = (label: string) => ({ label, value: () => true });
  const priceRows = [
    { label: 'Monthly price', value: (p: PlanDefinition) => priceCell(planPricing(prices, p.id).monthly) },
    ...(annualPublished ? [{ label: 'Annual price', value: (p: PlanDefinition) => priceCell(planPricing(prices, p.id).annual) }] : []),
  ];
  return [
    ...(prices.some((price) => price.amount > 0) ? [{ group: 'Price', rows: priceRows }] : []),
    {
      group: 'Capacity',
      rows: [
        { label: 'Locations (physical stores)', value: (p) => limit(p.limits.branches) },
        { label: 'Staff accounts', value: (p) => limit(p.limits.staff) },
        { label: 'Staff roles', value: (p) => (p.staffSlots === null ? 'Any mix' : staffSlotSummary(p.staffSlots)) },
        { label: 'Products', value: (p) => limit(p.limits.products) },
      ],
    },
    {
      group: 'Selling and stock',
      rows: [
        everyPlan('POS checkout'),
        everyPlan('Barcode scanning'),
        everyPlan('Inventory, stock-in and adjustments'),
        everyPlan('Low-stock indicators'),
        everyPlan('Product photos and printable receipts'),
        everyPlan('Refunds and voids'),
      ],
    },
    {
      group: 'Shifts and cash',
      rows: [everyPlan('Cashier shift management'), everyPlan('Cash reconciliation'), everyPlan('Cash in and cash out')],
    },
    {
      group: 'Reports and oversight',
      rows: [
        everyPlan('Sales dashboard and standard reports'),
        { label: 'Branch-level monitoring (each branch or all together)', value: multiBranch },
        everyPlan('CSV download of your products and sales'),
        { label: 'Report exports (CSV, Excel, PDF)', value: (p) => p.features.reportExports },
        { label: 'Activity / audit history', value: (p) => (p.auditHistoryDays === null ? 'Full history' : `${formatNumber(p.auditHistoryDays, 0)} days`) },
        { label: 'Role and permission customization', value: (p) => p.features.customRoles },
        {
          label: 'Photo background removal',
          value: (p) => (p.features.backgroundRemoval && p.limits.backgroundRemovalsPerMonth ? `${limit(p.limits.backgroundRemovalsPerMonth)} / month` : false),
        },
      ],
    },
    { group: 'Support', rows: [{ label: 'Support', value: () => SUPPORT_LABEL }] },
    { group: 'Coming soon', rows: COMING_SOON.map((label) => ({ label, value: () => 'Coming soon' })) },
  ];
}

const ACCENT: Record<PlanId, string> = {
  BASIC: 'text-blue-400',
  BUSINESS: 'text-emerald-400',
  ENTERPRISE: 'text-violet-400',
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
        <Minus className="mx-auto h-4 w-4 text-zinc-600" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  return <span className="tabular font-medium text-zinc-100">{cell}</span>;
}

/**
 * "Compare all features", under the cards: a native disclosure, so it opens
 * by keyboard and without script. The table scrolls sideways on narrow
 * screens with the feature names kept in view.
 */
export function PlanComparison({ currentPlan, prices = [] }: { currentPlan: PlanId | null; prices?: Price[] }) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-[#121316] [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
        <span>
          <span className="block text-base font-semibold text-white">Compare all features</span>
          <span className="block text-xs text-zinc-400">Prices, limits and every feature, plan by plan</span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="overflow-x-auto border-t border-white/10 scrollbar-thin">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr className="border-b border-white/10">
              <th scope="col" className="sticky left-0 z-10 bg-[#121316] px-4 py-3 text-left font-semibold text-zinc-300">
                Feature
              </th>
              {PLAN_ORDER.map((id) => (
                <th key={id} scope="col" className={cn('px-4 py-3 text-center font-semibold', ACCENT[id])} aria-current={id === currentPlan ? 'true' : undefined}>
                  {PLANS[id].name}
                  {id === currentPlan && <span className="block text-[11px] font-medium text-zinc-400">Your plan</span>}
                </th>
              ))}
            </tr>
          </thead>
          {comparisonRows(prices).map(({ group, rows }) => (
            <tbody key={group}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={PLAN_ORDER.length + 1}
                  className="bg-white/[0.03] px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500"
                >
                  {group}
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-white/[0.06]">
                  <th scope="row" className="sticky left-0 z-10 bg-[#121316] px-4 py-3 text-left font-normal text-zinc-400">
                    {row.label}
                  </th>
                  {PLAN_ORDER.map((id) => (
                    <td key={id} className={cn('px-4 py-3 text-center', id === 'BUSINESS' && 'bg-emerald-400/[0.04]')}>
                      <CellValue cell={row.value(PLANS[id])} plan={id} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </details>
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
    a: 'Annual billing costs less than twelve monthly payments. The saving on each plan is shown on its card when you switch to Annual.',
  },
];

/** A few short answers about billing. Native disclosure elements: keyboard and screen-reader friendly without script. */
export function PlanFaq() {
  return (
    <section aria-labelledby="plan-faq-title" className="space-y-3">
      <h3 id="plan-faq-title" className="text-lg font-semibold tracking-tight text-white">
        Questions
      </h3>
      <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-[#121316]">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-1 text-sm font-medium text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
              {q}
              <span className="text-muted-foreground transition-transform duration-200 group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="pb-1 pt-2 text-sm leading-relaxed text-zinc-400">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
