/**
 * Notification rules shared by the bell, the notification pages and the code
 * that raises administrator notifications. Pure, so they are unit-tested.
 */

/** The bell's badge: nothing at zero, the count up to 99, then "99+". */
export function badgeLabel(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > 99 ? '99+' : String(Math.floor(unread));
}

/** "Just now" for anything under a minute; otherwise "5 minutes ago", "yesterday", and so on. */
export function notificationTime(createdAt: string | Date, now: Date = new Date()): string {
  const at = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const seconds = Math.round((now.getTime() - at.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit);
  }
  return 'Just now';
}

export type NotificationFilter = 'all' | 'unread';

export function parseNotificationFilter(value: unknown): NotificationFilter {
  return value === 'unread' ? 'unread' : 'all';
}

/**
 * The events administrators are notified about. Each is raised only where
 * the event actually happens; none implies money owed unless an invoice
 * exists (a trial ending is never presented as a debt).
 */
export const PLATFORM_NOTIFICATION_KINDS = {
  STORE_CREATED: { label: 'Store created', tone: 'primary' },
  OWNER_CREATED: { label: 'Owner account created', tone: 'primary' },
  TRIAL_ENDING: { label: 'Trial ending soon', tone: 'warning' },
  TRIAL_ENDED: { label: 'Trial ended', tone: 'warning' },
  GRACE_STARTED: { label: 'Grace period started', tone: 'warning' },
  PLAN_SELECTED: { label: 'Plan selected', tone: 'primary' },
  PAYMENT_SUBMITTED: { label: 'Payment to verify', tone: 'warning' },
  PAYMENT_VERIFIED: { label: 'Payment verified', tone: 'success' },
  PAYMENT_REJECTED: { label: 'Payment rejected', tone: 'destructive' },
  SUBSCRIPTION_RENEWED: { label: 'Subscription renewed', tone: 'success' },
  INVOICE_OVERDUE: { label: 'Invoice overdue', tone: 'destructive' },
  STORE_SUSPENDED: { label: 'Store suspended', tone: 'destructive' },
  STORE_RESTORED: { label: 'Store restored', tone: 'success' },
  ACCESS_DENIED: { label: 'Denied admin action', tone: 'destructive' },
  SESSION_LOCKOUT: { label: 'Lock-screen lockout', tone: 'destructive' },
  SUPPORT_TICKET_CREATED: { label: 'New support ticket', tone: 'primary' },
  SUPPORT_USER_REPLIED: { label: 'Support reply from user', tone: 'warning' },
} as const;

export type PlatformNotificationKind = keyof typeof PLATFORM_NOTIFICATION_KINDS;
export type NotificationTone = 'primary' | 'success' | 'warning' | 'destructive' | 'muted';

export function platformKindTone(kind: string): NotificationTone {
  return (PLATFORM_NOTIFICATION_KINDS as Record<string, { tone: NotificationTone }>)[kind]?.tone ?? 'muted';
}

/**
 * Keys that make a platform notification unique to its event, so raising it
 * twice (a retry, a page load and the daily job) stores it once. Each names
 * the thing it is about and, for repeatable events, the moment that makes it
 * a distinct occurrence.
 */
export const platformNotificationKey = {
  storeCreated: (storeId: string) => `store:${storeId}:created`,
  ownerCreated: (userId: string) => `user:${userId}:owner-created`,
  trialEnding: (storeId: string, trialEndsAt: Date) => `store:${storeId}:trial-ending:${trialEndsAt.toISOString().slice(0, 10)}`,
  graceStarted: (storeId: string, endedAt: Date) => `store:${storeId}:grace:${endedAt.toISOString()}`,
  paymentVerified: (paymentId: string) => `payment:${paymentId}:verified`,
  paymentRejected: (paymentId: string) => `payment:${paymentId}:rejected`,
  renewed: (paymentId: string) => `payment:${paymentId}:renewed`,
  statusChanged: (storeId: string, status: string, at: Date) => `store:${storeId}:status:${status}:${at.toISOString()}`,
  accessDenied: (userId: string, attempt: string, at: Date) => `denied:${userId}:${attempt}:${at.toISOString().slice(0, 16)}`,
  lockout: (sessionId: string) => `session:${sessionId}:lockout`,
  supportTicketCreated: (ticketId: string) => `support:${ticketId}:created`,
  supportUserReplied: (messageId: string) => `support-message:${messageId}:user-replied`,
};

/** What the bell and the notification pages render, for either audience. */
export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  read: boolean;
  tone: NotificationTone;
}

const STORE_TYPE_TONE: Record<string, NotificationTone> = {
  SHIFT_OPENED: 'primary',
  SHIFT_CLOSED: 'muted',
  SHIFT_SHORTAGE: 'destructive',
  SHIFT_OVERAGE: 'warning',
  SHIFT_OVERDUE: 'warning',
  BILLING_REMINDER: 'warning',
  INVOICE_CREATED: 'primary',
  PAYMENT_SUBMITTED: 'warning',
  PAYMENT_VERIFIED: 'success',
  PAYMENT_REJECTED: 'destructive',
  SUPPORT_REPLY: 'primary',
};

export function storeTypeTone(type: string): NotificationTone {
  return STORE_TYPE_TONE[type] ?? 'muted';
}

/** Only same-site paths are followed from a notification; anything else is dropped. */
export function safeNotificationHref(href: string | null): string | null {
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null;
  return href;
}
