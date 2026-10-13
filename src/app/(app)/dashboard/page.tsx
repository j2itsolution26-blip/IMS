import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser, requirePermission, userCan } from '@/lib/session';
import { resolveRangeFromParams } from '@/server/analytics/date-range';
import { getDashboardOverview } from '@/server/analytics/dashboard-overview';
import { getSettings, readString } from '@/server/services/settings-service';
import { DashboardView } from '@/features/dashboard/dashboard-view';

export const metadata: Metadata = { title: 'Dashboard' };

// Every figure is live; caching would show the owner yesterday's numbers.
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  // A platform administrator holds no store permissions, so the dashboard is
  // not theirs to see. Sending them to their own screen beats bouncing them
  // off a permission check on the page every sign-in lands on.
  const signedIn = await requireUser();
  if (!userCan(signedIn, 'dashboard.view') && userCan(signedIn, 'platform.view')) {
    redirect('/system-admin');
  }

  const user = await requirePermission('dashboard.view');
  const params = await searchParams;
  const { period, range, custom } = resolveRangeFromParams(params, 'today');

  const settings = await getSettings();
  const currency = readString(settings, 'locale.currency') || 'PHP';

  // One pass for the whole page, so every panel agrees on the window and the
  // dashboard is not a dozen separate round trips.
  const data = await getDashboardOverview(range);

  return (
    <DashboardView
      firstName={user.name.split(' ')[0]}
      period={period}
      range={range}
      custom={custom}
      currency={currency}
      data={data}
      can={{
        sell: userCan(user, 'pos.create'),
        createProduct: userCan(user, 'products.create'),
        adjustStock: userCan(user, 'inventory.create'),
      }}
    />
  );
}
