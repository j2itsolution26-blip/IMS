import type { TimelineStepKey, TimelineStepState } from './billing';

/**
 * The owner's checkout progress: Choose plan → Review invoice → Pay via
 * GCash → Upload receipt → Await verification → Active subscription, read
 * from one invoice's payment timeline (`paymentTimeline`). Pure, so it is
 * unit-tested. "Active" is done only once the invoice is paid, which happens
 * solely when the administrator verifies a payment.
 */

export type CheckoutStepState = 'done' | 'current' | 'upcoming' | 'failed';

export interface CheckoutStep {
  label: string;
  state: CheckoutStepState;
  /** An ISO date to show, or a short note. */
  at: string | null;
  note: string | null;
}

export function checkoutSteps(input: {
  issuedAt: string;
  timeline: { key: TimelineStepKey; state: TimelineStepState; at: string | null; reason?: string }[];
  hasPending: boolean;
  rejectionReason: string | null;
}): CheckoutStep[] {
  const step = (key: TimelineStepKey) => input.timeline.find((item) => item.key === key);
  const reported = step('REPORTED');
  const decision = step('DECISION');
  const activated = step('ACTIVATED');
  const rejected = decision?.state === 'failed' && !input.hasPending;
  const submitted = reported?.state === 'done' && !rejected;
  const verified = decision?.state === 'done';

  return [
    { label: 'Choose plan', state: 'done', at: input.issuedAt, note: null },
    { label: 'Review invoice', state: 'done', at: input.issuedAt, note: null },
    {
      label: 'Pay via GCash',
      state: submitted || rejected ? 'done' : 'current',
      at: submitted ? (reported?.at ?? null) : null,
      note: submitted || rejected ? null : 'Waiting for you',
    },
    {
      label: 'Upload receipt',
      state: submitted ? 'done' : rejected ? 'current' : 'upcoming',
      at: submitted ? (reported?.at ?? null) : null,
      note: rejected ? 'Submit corrected proof' : null,
    },
    {
      label: rejected ? 'Rejected' : 'Await verification',
      state: rejected ? 'failed' : verified ? 'done' : submitted ? 'current' : 'upcoming',
      at: verified ? (decision?.at ?? null) : null,
      note: rejected ? input.rejectionReason : submitted && !verified ? 'Being checked' : null,
    },
    { label: 'Active subscription', state: activated?.state === 'done' ? 'done' : 'upcoming', at: activated?.at ?? null, note: null },
  ];
}
