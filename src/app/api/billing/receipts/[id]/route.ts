import { NextResponse } from 'next/server';
import { getCurrentUser, userCan } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';
import { findReceiptForAdmin, findReceiptForOwner } from '@/server/platform/payment-review-queries';
import { billingSignedUrl } from '@/server/platform/billing-storage';

export const dynamic = 'force-dynamic';

/**
 * A payment receipt, for the owner of the store that submitted it or a
 * platform administrator. Everyone else — staff of the same store included —
 * gets the same 404, whether or not the file exists. The answer is a redirect
 * to a link that expires in a minute, never the bucket's address.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const user = await getCurrentUser().catch(() => null);
  if (!user || user.mustChangePassword || user.isLocked) return notFound();
  try {
    checkRateLimit(`billing:receipt:${user.id}`, RATE_LIMITS.read);
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(id)) return notFound();

  const file = userCan(user, 'platform.view')
    ? await findReceiptForAdmin(id)
    : user.store && userCan(user, 'billing.view')
      ? await findReceiptForOwner(user.id, id)
      : null;
  if (!file) return notFound();

  try {
    const download = new URL(request.url).searchParams.get('download') === '1';
    const url = await billingSignedUrl(file.storagePath, download ? file.originalName : undefined);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 502;
    return NextResponse.json({ error: 'File unavailable' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
