'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { notificationTime, type NotificationFilter, type NotificationItem } from '@/lib/notifications';
import { markMyNotificationsReadAction } from '@/features/notifications/actions';
import { NotificationIcon } from '@/features/notifications/notification-bell';

/**
 * The full notification history for the signed-in user (platform or store,
 * decided on the server). Opening an unread notification marks it read; the
 * list refreshes from the server afterwards so it never shows a state the
 * server did not accept.
 */
export function NotificationList({
  items,
  unread,
  filter,
  basePath,
}: {
  items: NotificationItem[];
  unread: number;
  filter: NotificationFilter;
  basePath: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const markRead = async (ids?: string[]) => {
    const result = await markMyNotificationsReadAction(ids ? { ids } : {});
    if (!result.ok) {
      toast.error('Could not mark notifications as read. Try again.');
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <nav aria-label="Show" className="inline-flex rounded-full bg-muted p-1">
          {(['all', 'unread'] as const).map((option) => (
            <Link
              key={option}
              href={option === 'all' ? basePath : `${basePath}?filter=unread`}
              aria-current={filter === option ? 'page' : undefined}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === option ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'all' ? 'All' : `Unread (${unread})`}
            </Link>
          ))}
        </nav>
        <Button
          variant="outline"
          size="sm"
          disabled={unread === 0}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            if (await markRead()) toast.success('All notifications marked as read.');
            setBusy(false);
          }}
        >
          <CheckCheck /> Mark all as read
        </Button>
      </div>

      <ul className="divide-y">
        {items.map((item) => {
          const inner = (
            <>
              <NotificationIcon tone={item.tone} />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', !item.read && 'font-semibold')}>{item.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>
                <span className="mt-1 block text-xs text-muted-foreground" title={formatDateTime(item.createdAt)}>
                  {notificationTime(item.createdAt)}
                  {!item.read && <span className="sr-only"> · unread</span>}
                </span>
              </span>
              {!item.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
            </>
          );
          const rowClass = cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40', !item.read && 'bg-primary/[0.04]');
          return (
            <li key={item.id}>
              {item.href ? (
                <Link href={item.href} className={rowClass} onClick={() => { if (!item.read) void markRead([item.id]); }}>
                  {inner}
                </Link>
              ) : (
                <button type="button" className={rowClass} onClick={() => { if (!item.read) void markRead([item.id]); }}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
