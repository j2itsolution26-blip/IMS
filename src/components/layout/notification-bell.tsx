'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Info,
  PackageCheck,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { NotificationSeverity, NotificationType } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/misc';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/format';
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/features/notifications/actions';

export interface NotificationView {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const SEVERITY_ICON = {
  INFO: Info,
  SUCCESS: PackageCheck,
  WARNING: AlertTriangle,
  CRITICAL: ShieldAlert,
} as const;

const SEVERITY_COLOR = {
  INFO: 'text-primary',
  SUCCESS: 'text-success',
  WARNING: 'text-warning',
  CRITICAL: 'text-destructive',
} as const;

export function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationView[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const onOpen = (notification: NotificationView) => {
    if (!notification.readAt) {
      startTransition(async () => {
        await markNotificationRead(notification.id);
        router.refresh();
      });
    }
  };

  const onDismiss = (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    startTransition(async () => {
      await dismissNotification(id);
      router.refresh();
    });
  };

  const onMarkAll = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onMarkAll} disabled={pending} className="h-7 text-xs">
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <Separator />

        {notifications.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <Bell className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Stock alerts and activity will show up here.
            </p>
          </div>
        ) : (
          <ul className="max-h-[26rem] overflow-y-auto scrollbar-thin">
            {notifications.map((notification) => {
              const Icon = SEVERITY_ICON[notification.severity];
              const body = (
                <div className="flex w-full items-start gap-2.5">
                  <Icon
                    className={cn('mt-0.5 h-4 w-4 shrink-0', SEVERITY_COLOR[notification.severity])}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{notification.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{notification.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                      {formatRelative(notification.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => onDismiss(e, notification.id)}
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Dismiss ${notification.title}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );

              return (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      onClick={() => onOpen(notification)}
                      className={cn(
                        'group flex px-3 py-2.5 transition-colors hover:bg-accent/60',
                        !notification.readAt && 'bg-primary/5',
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      className={cn(
                        'group flex px-3 py-2.5 transition-colors hover:bg-accent/60',
                        !notification.readAt && 'bg-primary/5',
                      )}
                    >
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Separator />
        <Link
          href="/notifications"
          className="block px-3 py-2.5 text-center text-sm font-medium text-primary hover:underline"
        >
          View all notifications
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
