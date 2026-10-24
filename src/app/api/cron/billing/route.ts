import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { runBillingReminders } from '@/server/platform/billing-reminders';
import { syncSupportNotifications } from '@/server/support/support-notify';

export const dynamic = 'force-dynamic';

/**
 * Daily billing reminders (vercel.json → crons). Reachable without a session
 * — middleware lets /api/cron through — so the secret is the only gate: no
 * CRON_SECRET configured means every call is refused. Idempotent; returns
 * counts only, never store or billing details.
 *
 * Also raises any support notification that failed when its ticket or reply
 * was saved (each has a unique key, so nothing is raised twice). A failure
 * there never stops the billing run.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const result = await runBillingReminders(now);
  const support = await syncSupportNotifications(now).catch((error) => {
    console.error('[cron] support notification sync failed', error);
    return { checked: 0, failed: true };
  });
  return NextResponse.json({ ok: true, ...result, support });
}
