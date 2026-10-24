import { NextResponse } from 'next/server';
import { getCurrentUser, userCan } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';
import { findMyAttachment } from '@/server/support/support-service';
import { findAttachmentForAdmin } from '@/server/support/support-admin-service';
import { signedUrlFor } from '@/server/support/support-storage';

export const dynamic = 'force-dynamic';

/**
 * A support screenshot, for someone allowed to read the conversation it is
 * in: the requester (public messages of their own tickets only) or a
 * platform administrator. Everyone else gets the same 404, whether or not the
 * file exists. The answer is a redirect to a link that expires in a minute,
 * never the bucket's address.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const user = await getCurrentUser().catch(() => null);
  if (!user || user.mustChangePassword || user.isLocked) return notFound();
  try {
    checkRateLimit(`support:file:${user.id}`, RATE_LIMITS.read);
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(id)) return notFound();

  const file = userCan(user, 'platform.view')
    ? await findAttachmentForAdmin(id)
    : userCan(user, 'support.create')
      ? await findMyAttachment(user.id, id)
      : null;
  if (!file) return notFound();

  try {
    const url = await signedUrlFor(file.storagePath);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 502;
    return NextResponse.json({ error: 'File unavailable' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
