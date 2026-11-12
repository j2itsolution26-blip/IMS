import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui';
import { login } from './actions';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  if ((await prisma.user.count()) === 0) redirect('/setup');
  const settings = await prisma.barangaySettings.findUnique({ where: { id: 1 } });

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Barangay System</p>
        <h1 className="mt-1 text-xl font-semibold">{settings ? `Barangay ${settings.barangayName}` : 'Sign in'}</h1>
        {settings && (
          <p className="text-sm text-slate-500">
            {settings.city}, {settings.province}
          </p>
        )}
        <div className="mt-6">
          <ActionForm action={login} submitLabel="Sign in" submitClassName="btn-primary w-full">
            <Field label="Username">
              <input name="username" className="input" autoComplete="username" required autoFocus />
            </Field>
            <Field label="Password">
              <input name="password" type="password" className="input" autoComplete="current-password" required />
            </Field>
          </ActionForm>
        </div>
      </div>
    </main>
  );
}
