'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Clock, Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import {
  badgeLabel,
  notificationTime,
  type NotificationFilter,
  type NotificationItem,
  type NotificationTone,
} from '@/lib/notifications';
import { listMyNotificationsAction, markMyNotificationsReadAction } from '@/features/notifications/actions';

const TONE_ICON: Record<NotificationTone, { icon: typeof Bell; className: string }> = {
  primary: { icon: Info, className: 'bg-primary/10 text-primary' },
  success: { icon: CheckCircle2, className: 'bg-success/10 text-success-text' },
  warning: { icon: Clock, className: 'bg-warning/15 text-warning-text' },
  destructive: { icon: AlertTriangle, className: 'bg-destructive/10 text-destructive-text' },
  muted: { icon: Bell, className: 'bg-muted text-muted-foreground' },
};

/** The icon chip for a notification's tone; shared with the full notification pages. */
export function NotificationIcon({ tone }: { tone: NotificationTone }) {
  const { icon: Icon, className } = TONE_ICON[tone];
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', className)} aria-hidden="true">
      <Icon className="h-4 w-4" />
    </span>
  );
}

type Status = 'loading' | 'ready' | 'error';

/**
 * The header's notification centre, for whoever is signed in — the server
 * decides whether that means platform or store notifications. Fetches on
 * load, on open, and on a slow poll while the tab is visible; never reads
 * the audit log. Read changes show at once and are rolled back if the server
 * refuses them.
 */
export function NotificationBell({ viewAllHref, pollMs = 120_000 }: { viewAllHref: string; pollMs?: number }) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<NotificationFilter>('all');
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [status, setStatus] = React.useState<Status>('loading');
  const filterRef = React.useRef(filter);
  filterRef.current = filter;

  const load = React.useCallback(async (nextFilter: NotificationFilter = filterRef.current) => {
    try {
      const result = await listMyNotificationsAction({ filter: nextFilter, limit: 20 });
      if (!result.ok) {
        setStatus('error');
        return;
      }
      // A newer request for another filter may have landed first; keep the latest.
      if (nextFilter !== filterRef.current) return;
      setItems(result.data.items);
      setUnread(result.data.unread);
      setStatus('ready');
    } catch {
      // Offline or mid-deploy: keep what is shown and say so in the panel.
      setStatus('error');
    }
  }, []);

  React.useEffect(() => {
    void load();
    const poll = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(poll, pollMs);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [load, pollMs]);

  const changeFilter = (next: NotificationFilter) => {
    if (next === filter) return;
    setFilter(next);
    filterRef.current = next;
    setStatus('loading');
    void load(next);
  };

  const markRead = async (ids?: string[]) => {
    const previous = { items, unread };
    const affected = ids ? items.filter((item) => ids.includes(item.id) && !item.read).length : unread;
    setItems((current) =>
      filter === 'unread'
        ? current.filter((item) => ids && !ids.includes(item.id))
        : current.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)),
    );
    setUnread((count) => Math.max(0, count - affected));
    try {
      const result = await markMyNotificationsReadAction(ids ? { ids } : {});
      if (!result.ok) throw new Error(result.error);
      void load();
    } catch {
      setItems(previous.items);
      setUnread(previous.unread);
      toast.error('Could not mark notifications as read. Try again.');
    }
  };

  const badge = badgeLabel(unread);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 text-muted-foreground hover:text-foreground"
          aria-label={badge ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="h-5 w-5" />
          {badge && (
            <span className="tabular absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground ring-2 ring-card">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="flex w-[min(24rem,calc(100vw-1rem))] flex-col p-0" aria-label="Notifications">
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Notifications</h2>
            {unread > 0 && (
              <span className="tabular rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{unread} unread</span>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={unread === 0} onClick={() => void markRead()}>
            <CheckCheck /> Mark all as read
          </Button>
        </div>

        <div role="radiogroup" aria-label="Show" className="mx-4 mb-2 inline-flex w-fit rounded-full bg-muted p-1">
          {(['all', 'unread'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={filter === option}
              onClick={() => changeFilter(option)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === option ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>

        <div className="max-h-[min(28rem,65dvh)] overflow-y-auto overscroll-contain scrollbar-thin border-t">
          {status === 'loading' && items.length === 0 ? (
            <ul className="space-y-1 p-2" aria-busy="true" aria-label="Loading notifications">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index} className="flex gap-3 p-2">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : status === 'error' && items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">Notifications could not be loaded.</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                <RefreshCw /> Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
              <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success-text" aria-hidden="true">
                <CheckCheck className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium">You&apos;re all caught up.</p>
              <p className="text-xs text-muted-foreground">
                {filter === 'unread' ? 'No unread notifications.' : 'New notifications will appear here.'}
              </p>
            </div>
          ) : (
            <ul className="p-1.5">
              {items.map((item) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    onOpen={() => {
                      setOpen(false);
                      if (!item.read) void markRead([item.id]);
                    }}
                    onMarkRead={() => void markRead([item.id])}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t p-1.5">
          <Link
            href={viewAllHref}
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-center text-sm font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  item,
  onOpen,
  onMarkRead,
}: {
  item: NotificationItem;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const content = (
    <>
      <NotificationIcon tone={item.tone} />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm leading-snug', item.read ? 'text-foreground/80' : 'font-semibold')}>{item.title}</span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{item.body}</span>
        <span className={cn('mt-1 block text-[11px]', item.read ? 'text-muted-foreground' : 'font-medium text-primary')}>
          {notificationTime(item.createdAt)}
          {!item.read && <span className="sr-only"> · unread</span>}
        </span>
      </span>
      {!item.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
    </>
  );
  const rowClass = cn(
    'flex w-full gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    !item.read && 'bg-primary/[0.04]',
  );

  if (item.href) {
    return (
      <Link href={item.href} onClick={onOpen} className={rowClass}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={item.read ? undefined : onMarkRead} className={rowClass} aria-disabled={item.read || undefined}>
      {content}
    </button>
  );
}
