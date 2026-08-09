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
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NotificationSeverity, NotificationType } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { EmptyState } from '@/components/empty-state';
import {
  dismissAllNotifications,
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/features/notifications/actions';
import { formatRelative, humanizeEnum } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface NotificationItem {
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

const SEVERITY_STYLE = {
  INFO: 'bg-primary/10 text-primary',
  SUCCESS: 'bg-success/10 text-success',
  WARNING: 'bg-warning/15 text-warning',
  CRITICAL: 'bg-destructive/10 text-destructive',
} as const;

type Filter = 'all' | 'unread' | 'critical';

export function NotificationList({
  notifications,
  canManage,
}: {
  notifications: NotificationItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [pending, startTransition] = React.useTransition();

  const visible = notifications.filter((item) => {
    if (filter === 'unread') return !item.readAt;
    if (filter === 'critical') return item.severity === 'CRITICAL' || item.severity === 'WARNING';
    return true;
  });

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? 'That did not work.');
        return;
      }
      toast.success(success);
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All ({notifications.length})</TabsTrigger>
            <TabsTrigger value="unread">Unread ({unreadCount})</TabsTrigger>
            <TabsTrigger value="critical">Needs attention</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => markAllNotificationsRead(), 'All marked as read.')}
            >
              <CheckCheck /> Mark all read
            </Button>
          )}
          {canManage && notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => dismissAllNotifications(), 'Notifications cleared.')}
            >
              <Trash2 /> Clear all
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bell}
            title={filter === 'all' ? "You're all caught up" : 'Nothing here'}
            description={
              filter === 'all'
                ? 'Low stock, late deliveries, large sales, price changes, and returns all raise alerts automatically.'
                : 'Try a different filter to see the rest of your notifications.'
            }
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => {
            const Icon = SEVERITY_ICON[item.severity];

            return (
              <li key={item.id}>
                <Card className={cn('p-3.5 transition-colors', !item.readAt && 'border-primary/30 bg-primary/[0.03]')}>
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                        SEVERITY_STYLE[item.severity],
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{item.title}</p>
                        <Badge variant="secondary">{humanizeEnum(item.type)}</Badge>
                        {!item.readAt && <Badge variant="default">New</Badge>}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{item.message}</p>
                      <p className="mt-1 text-xs text-muted-foreground/80">{formatRelative(item.createdAt)}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {item.link && (
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          onClick={() => {
                            if (!item.readAt) void markNotificationRead(item.id);
                          }}
                        >
                          <Link href={item.link}>View</Link>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        onClick={() => run(() => dismissNotification(item.id), 'Dismissed.')}
                        aria-label={`Dismiss ${item.title}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
