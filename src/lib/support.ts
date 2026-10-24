import { z } from 'zod';

/**
 * Customer support rules shared by the requester pages, the administrators'
 * inbox and the server code behind both. Pure (no database, no session), so
 * the workflow is unit-tested directly in tests/support.test.ts.
 *
 * The server is the only place a status changes: every transition below is
 * checked there, whatever the browser sent.
 */

export const SUPPORT_CATEGORIES = [
  'TECHNICAL_ISSUE',
  'BUG_REPORT',
  'FEATURE_REQUEST',
  'BILLING',
  'ACCOUNT_LOGIN',
  'INSTALLATION',
  'GENERAL',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export type SupportTone = 'primary' | 'success' | 'warning' | 'destructive' | 'muted';

/** Labels and hints written for a store owner, not an engineer. */
export const CATEGORY_INFO: Record<SupportCategory, { label: string; hint: string; priority: SupportPriority }> = {
  TECHNICAL_ISSUE: { label: 'Technical issue', hint: 'Something is slow, stuck or not loading.', priority: 'NORMAL' },
  BUG_REPORT: { label: 'Bug report', hint: 'Something gives a wrong result or an error.', priority: 'NORMAL' },
  FEATURE_REQUEST: { label: 'Feature request', hint: 'An idea that would make the app better for you.', priority: 'LOW' },
  BILLING: { label: 'Billing & subscription', hint: 'Plans, invoices, payments or a suspended store.', priority: 'HIGH' },
  ACCOUNT_LOGIN: { label: 'Account & login', hint: 'Signing in, passwords or staff accounts.', priority: 'HIGH' },
  INSTALLATION: { label: 'Installation', hint: 'Installing the app, printers or scanners.', priority: 'NORMAL' },
  GENERAL: { label: 'General concern', hint: 'Anything else you want to tell us.', priority: 'NORMAL' },
};

export const STATUS_INFO: Record<SupportStatus, { label: string; tone: SupportTone; requesterHint: string }> = {
  NEW: { label: 'New', tone: 'primary', requesterHint: 'Sent. Support will look at it soon.' },
  OPEN: { label: 'Open', tone: 'primary', requesterHint: 'Support has your concern.' },
  IN_PROGRESS: { label: 'In progress', tone: 'warning', requesterHint: 'Support is working on it.' },
  WAITING_FOR_USER: { label: 'Waiting for you', tone: 'warning', requesterHint: 'Support needs a reply from you.' },
  RESOLVED: { label: 'Resolved', tone: 'success', requesterHint: 'Marked as solved. Reply if it is not.' },
  CLOSED: { label: 'Closed', tone: 'muted', requesterHint: 'This ticket is closed. Open a new one if you need help.' },
};

export const PRIORITY_INFO: Record<SupportPriority, { label: string; tone: SupportTone }> = {
  LOW: { label: 'Low', tone: 'muted' },
  NORMAL: { label: 'Normal', tone: 'primary' },
  HIGH: { label: 'High', tone: 'warning' },
  URGENT: { label: 'Urgent', tone: 'destructive' },
};

/** The priority a new ticket gets. Requesters never choose it (support policy). */
export function defaultPriority(category: SupportCategory): SupportPriority {
  return CATEGORY_INFO[category].priority;
}

/** Statuses an administrator may move a ticket to from each status. */
const ADMIN_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  NEW: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  OPEN: ['IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_USER: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  // Reopening a closed ticket is the one way back, and it is confirmed and audited.
  CLOSED: ['OPEN'],
};

export function adminTargets(from: SupportStatus): readonly SupportStatus[] {
  return ADMIN_TRANSITIONS[from];
}

export function canAdminTransition(from: SupportStatus, to: SupportStatus): boolean {
  return ADMIN_TRANSITIONS[from].includes(to);
}

/** Moves that deserve a confirmation dialog and a clear audit entry. */
export function isConsequentialTransition(from: SupportStatus, to: SupportStatus): boolean {
  return to === 'CLOSED' || to === 'RESOLVED' || (from === 'CLOSED' && to === 'OPEN');
}

/**
 * What a requester's reply does to the ticket. A ticket waiting on them, or
 * marked resolved, goes back to support as OPEN; a closed ticket takes no
 * replies (the requester opens a new one, or support reopens it).
 */
export function requesterReplyEffect(status: SupportStatus): { allowed: boolean; next: SupportStatus } {
  switch (status) {
    case 'CLOSED':
      return { allowed: false, next: status };
    case 'WAITING_FOR_USER':
    case 'RESOLVED':
      return { allowed: true, next: 'OPEN' };
    default:
      return { allowed: true, next: status };
  }
}

/**
 * What an administrator's public reply does. The first answer moves a NEW
 * ticket to OPEN; "reply and wait" asks the requester for more and sets
 * WAITING_FOR_USER. A closed ticket must be reopened first. Internal notes
 * never change the status.
 */
export function adminReplyEffect(
  status: SupportStatus,
  waitForUser: boolean,
): { allowed: boolean; next: SupportStatus } {
  if (status === 'CLOSED') return { allowed: false, next: status };
  if (waitForUser) return { allowed: true, next: 'WAITING_FOR_USER' };
  return { allowed: true, next: status === 'NEW' ? 'OPEN' : status };
}

/** The resolved/closed timestamps that go with entering `to`. */
export function lifecycleStamps(
  to: SupportStatus,
  current: { resolvedAt: Date | null; closedAt: Date | null },
  now: Date,
): { resolvedAt: Date | null; closedAt: Date | null } {
  switch (to) {
    case 'RESOLVED':
      return { resolvedAt: now, closedAt: null };
    case 'CLOSED':
      return { resolvedAt: current.resolvedAt, closedAt: now };
    default:
      return { resolvedAt: null, closedAt: null };
  }
}

export function isActiveStatus(status: SupportStatus): boolean {
  return status !== 'RESOLVED' && status !== 'CLOSED';
}

/**
 * Whether the requester has a reply they have not opened yet: support
 * answered after the requester last looked.
 */
export function hasUnreadReply(ticket: { lastAdminReplyAt: Date | null; requesterReadAt: Date | null }): boolean {
  if (!ticket.lastAdminReplyAt) return false;
  return !ticket.requesterReadAt || ticket.lastAdminReplyAt > ticket.requesterReadAt;
}

/**
 * Whether the ticket is waiting on support: still active and never answered,
 * or the requester wrote after the last answer.
 */
export function awaitingAdmin(ticket: {
  status: SupportStatus;
  lastAdminReplyAt: Date | null;
  lastRequesterReplyAt: Date | null;
}): boolean {
  if (ticket.status !== 'NEW' && ticket.status !== 'OPEN' && ticket.status !== 'IN_PROGRESS') return false;
  if (!ticket.lastAdminReplyAt) return true;
  return Boolean(ticket.lastRequesterReplyAt && ticket.lastRequesterReplyAt > ticket.lastAdminReplyAt);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;
export const NAME_MAX = 100;

/** Drops control characters (keeping newlines and tabs) and trims. */
export function cleanText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

/** A single line: newlines become spaces, runs of spaces collapse. */
export function cleanLine(value: string): string {
  return cleanText(value).replace(/\s+/g, ' ');
}

const line = (max: number, label: string) =>
  z
    .string({ required_error: `${label} is required.` })
    .transform(cleanLine)
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`));

const body = z
  .string({ required_error: 'Please describe your concern.' })
  .transform(cleanText)
  .pipe(
    z
      .string()
      .min(10, 'Please describe your concern in a few more words.')
      .max(BODY_MAX, `Please keep it under ${BODY_MAX} characters.`),
  );

/** A client-generated id for one form submission; stops double submits. */
const submissionKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Please reload the page and try again.');

export const createTicketSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES, { errorMap: () => ({ message: 'Choose a category.' }) }),
  subject: line(SUBJECT_MAX, 'Subject'),
  description: body,
  submissionKey,
});

export const publicTicketSchema = createTicketSchema.extend({
  name: line(NAME_MAX, 'Name'),
  email: z
    .string({ required_error: 'Email is required.' })
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().email('Enter a valid email address.').max(254, 'Enter a valid email address.')),
});

export const replySchema = z.object({
  message: z
    .string({ required_error: 'Write a message.' })
    .transform(cleanText)
    .pipe(z.string().min(1, 'Write a message.').max(BODY_MAX, `Please keep it under ${BODY_MAX} characters.`)),
});

/** SUP-000123, as typed in a URL. */
export const ticketNumberSchema = z.string().regex(/^SUP-\d{6,}$/);

export function isTicketNumber(value: unknown): value is string {
  return ticketNumberSchema.safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** The requester's list filter. "active" is everything not resolved or closed. */
export const REQUESTER_FILTERS = ['all', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] as const;
export type RequesterFilter = (typeof REQUESTER_FILTERS)[number];

export function parseRequesterFilter(value: unknown): RequesterFilter {
  return (REQUESTER_FILTERS as readonly unknown[]).includes(value) ? (value as RequesterFilter) : 'all';
}

/** "Open" on the requester's side includes NEW: both mean support has it. */
export function requesterFilterStatuses(filter: RequesterFilter): SupportStatus[] | null {
  if (filter === 'all') return null;
  if (filter === 'OPEN') return ['NEW', 'OPEN'];
  return [filter];
}

export const ADMIN_QUEUES = ['active', 'new', 'awaiting', 'waiting', 'resolved', 'closed', 'all'] as const;
export type AdminQueue = (typeof ADMIN_QUEUES)[number];

export const ADMIN_SORTS = ['activity', 'created', 'priority'] as const;
export type AdminSort = (typeof ADMIN_SORTS)[number];

export interface AdminInboxQuery {
  queue: AdminQueue;
  category: SupportCategory | null;
  priority: SupportPriority | null;
  q: string;
  sort: AdminSort;
  page: number;
  mine: boolean;
}

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return (values as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads the inbox's URL parameters, falling back to safe defaults for anything unexpected. */
export function parseAdminInboxQuery(params: Record<string, unknown>): AdminInboxQuery {
  const page = Number.parseInt(String(first(params.page) ?? '1'), 10);
  const q = first(params.q);
  return {
    queue: pick(ADMIN_QUEUES, first(params.queue), 'active'),
    category: (SUPPORT_CATEGORIES as readonly unknown[]).includes(first(params.category))
      ? (first(params.category) as SupportCategory)
      : null,
    priority: (SUPPORT_PRIORITIES as readonly unknown[]).includes(first(params.priority))
      ? (first(params.priority) as SupportPriority)
      : null,
    q: typeof q === 'string' ? cleanLine(q).slice(0, 100) : '',
    sort: pick(ADMIN_SORTS, first(params.sort), 'activity'),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    mine: first(params.mine) === '1',
  };
}

export const SUPPORT_PAGE_SIZE = 20;
