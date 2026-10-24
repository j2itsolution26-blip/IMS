import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { runBillingReminders } from '@/server/platform/billing-reminders';

export const dynamic = 'force-dynamic';

/**
 * Daily billing reminders (vercel.json → crons). Reachable without a session
 * — middleware lets /api/cron through — so the secret is the only gate: no
 * CRON_SECRET configured means every call is refused. Idempotent; returns
 * counts only, never store or billing details.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runBillingReminders(new Date());
  return NextResponse.json({ ok: true, ...result });
}
