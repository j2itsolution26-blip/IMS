import Link from 'next/link';
import { CheckCheck } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Panel, PanelEmpty } from '@/components/panel';
import { Button } from '@/components/ui/button';
import type { NotificationFilter, NotificationItem } from '@/lib/notifications';
import { NotificationList } from '@/features/notifications/notification-list';

export const NOTIFICATIONS_PAGE_SIZE = 25;

/** The shared layout of both notification pages; each page reads its own data on the server. */
export function NotificationsPage({
  title,
  description,
  basePath,
  filter,
  page,
  data,
}: {
  title: string;
  description: string;
  basePath: string;
  filter: NotificationFilter;
  page: number;
  data: { items: NotificationItem[]; unread: number; total: number };
}) {
  const pageCount = Math.max(1, Math.ceil(data.total / NOTIFICATIONS_PAGE_SIZE));
  const href = (target: number) => {
    const params = new URLSearchParams();
    if (filter === 'unread') params.set('filter', 'unread');
    if (target > 1) params.set('page', String(target));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  return (
    <>
      <PageHeader title={title} description={description} />
      <Panel title="Notifications" description={`${data.unread} unread`}>
        {data.items.length === 0 ? (
          <>
            <NotificationList items={[]} unread={data.unread} filter={filter} basePath={basePath} />
            <PanelEmpty
              icon={CheckCheck}
              title="You're all caught up."
              description={filter === 'unread' ? 'No unread notifications.' : 'New notifications will appear here.'}
            />
          </>
        ) : (
          <NotificationList items={data.items} unread={data.unread} filter={filter} basePath={basePath} />
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              Page {page} of {pageCount} · {data.total} notifications
            </span>
            <div className="flex gap-1">
              {page > 1 ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={href(page - 1)}>Previous</Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>Previous</Button>
              )}
              {page < pageCount ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={href(page + 1)}>Next</Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>Next</Button>
              )}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
