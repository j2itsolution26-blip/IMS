import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { ChangePasswordView } from '@/features/auth/change-password-view';

export const metadata: Metadata = { title: 'Change your password' };
export const dynamic = 'force-dynamic';

/**
 * Where an account with an administrator-chosen password is held until it
 * sets its own. Outside the app shell on purpose: it renders nothing from the
 * store — only who is signed in and the form. Reached by redirect from
 * `requireUser`; anyone without a pending change is sent on.
 */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/api/session/reset');
  if (!user.mustChangePassword) redirect('/dashboard');

  return <ChangePasswordView name={user.name} username={user.username} />;
}
