import { NextResponse } from 'next/server';
import { getCurrentUser, userCan } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';
import { findQrPath } from '@/server/platform/payment-review-queries';
import { billingSignedUrl } from '@/server/platform/billing-storage';

export const dynamic = 'force-dynamic';

/**
 * The QR code of a GCash account owners pay into, for a signed-in account
 * that can see billing (or the platform administrator, who also sees hidden
 * accounts). Not a secret — it is a payment destination — but it lives in the
 * private billing bucket, so it is handed out as a one-minute link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const user = await getCurrentUser().catch(() => null);
  if (!user || user.mustChangePassword || user.isLocked) return notFound();
  try {
    checkRateLimit(`billing:qr:${user.id}`, RATE_LIMITS.read);
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { accountId } = await params;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(accountId)) return notFound();

  const admin = userCan(user, 'platform.view');
  if (!admin && !(user.store && userCan(user, 'billing.view'))) return notFound();
  const path = await findQrPath(accountId, { admin });
  if (!path) return notFound();

  try {
    const url = await billingSignedUrl(path);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 502;
    return NextResponse.json({ error: 'File unavailable' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
