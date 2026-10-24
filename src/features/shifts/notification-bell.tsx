'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { listNotificationsAction, markNotificationsReadAction } from '@/features/shifts/actions';
import type { NotificationView } from '@/server/services/notification-service';

const POLL_MS = 60_000;

const TONE: Record<NotificationView['type'], string> = {
  SHIFT_OPENED: 'bg-primary',
  SHIFT_CLOSED: 'bg-muted-foreground',
  SHIFT_SHORTAGE: 'bg-destructive',
  SHIFT_OVERAGE: 'bg-warning',
  SHIFT_OVERDUE: 'bg-warning',
  BILLING_REMINDER: 'bg-warning',
  INVOICE_CREATED: 'bg-primary',
  PAYMENT_VERIFIED: 'bg-success',
  PAYMENT_REJECTED: 'bg-destructive',
};

/**
 * The owner's notices: shifts opened and closed, counts short or over, shifts
 * left open. Polls once a minute while the tab is visible — the server also
 * raises "left open" notices on that poll, so no timer job is needed.
 */
export function NotificationBell() {
  const [items, setItems] = React.useState<NotificationView[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const result = await listNotificationsAction();
      if (result.ok) {
        setItems(result.data.items);
        setUnread(result.data.unread);
      }
    } catch {
      // Offline or a deploy in progress: keep what is shown, try next poll.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const poll = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [load]);

  const markRead = async (ids?: string[]) => {
    setItems((current) => current.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)));
    setUnread((count) => (ids ? Math.max(0, count - ids.length) : 0));
    try {
      await markNotificationsReadAction({ ids });
    } finally {
      void load();
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 text-muted-foreground hover:text-foreground"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void markRead()}>
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing yet. Shift openings and closings appear here.</p>
        ) : (
          <ul className="max-h-[min(26rem,70dvh)] divide-y overflow-y-auto">
            {items.map((item) => {
              const body = (
                <div className="flex gap-2.5 px-3 py-2.5">
                  <span
                    className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.read ? 'bg-transparent' : TONE[item.type])}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm leading-snug', !item.read && 'font-semibold')}>{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatRelative(item.createdAt)}
                      {!item.read && <span className="sr-only"> · unread</span>}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="block hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      onClick={() => {
                        setOpen(false);
                        if (!item.read) void markRead([item.id]);
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
