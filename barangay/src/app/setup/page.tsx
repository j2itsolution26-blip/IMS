import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { ActionForm } from '@/components/action-form';
import { Field, Notice } from '@/components/ui';
import { completeSetup } from './actions';

export const metadata = { title: 'First-time setup' };
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect('/login');

  return (
    <main className="mx-auto max-w-xl p-4 py-10">
      <h1 className="text-2xl font-semibold">Set up your barangay</h1>
      <p className="mt-1 text-sm text-slate-500">
        This runs once. It creates the Punong Barangay&apos;s account, which then adds the other staff accounts.
      </p>
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ActionForm action={completeSetup} submitLabel="Finish setup">
          <Notice>Enter the SETUP_TOKEN value set on the server. Remove it from the server after setup.</Notice>
          <Field label="Setup token">
            <input name="token" type="password" className="input" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Barangay name" hint="Without the word “Barangay”">
              <input name="barangayName" className="input" required />
            </Field>
            <Field label="City or municipality">
              <input name="city" className="input" required />
            </Field>
            <Field label="Province">
              <input name="province" className="input" required />
            </Field>
            <Field label="Punong Barangay's full name">
              <input name="captainName" className="input" required />
            </Field>
          </div>
          <Field label="Puroks / sitios" hint="One per line. You can add more later in Settings.">
            <textarea name="puroks" rows={4} className="input" placeholder={'Purok 1\nPurok 2'} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username for the Punong Barangay">
              <input name="username" className="input" autoComplete="username" required />
            </Field>
            <Field label="Password" hint="At least 10 characters, with a letter and a number">
              <input name="password" type="password" className="input" autoComplete="new-password" required />
            </Field>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
