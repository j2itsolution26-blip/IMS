import { getCurrentUser } from '@/lib/session';
import { fail, json } from '@/server/pos/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Who this browser is signed in as. The offline till asks before handing
 * over to the full till, so a cashier unlocked offline never continues under
 * someone else's session.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return fail(401, 'UNAUTHORIZED', 'You need to sign in to continue.', false);
    // Identity only, no store data. A pending password change is reported so
    // the till sends the cashier to sign in rather than to the full till.
    return json({ ok: true, user: { id: user.id, storeId: user.store?.id ?? null, locked: user.isLocked, mustChangePassword: user.mustChangePassword } });
  } catch {
    return fail(503, 'UNAVAILABLE', 'The session could not be checked.');
  }
}
