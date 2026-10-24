import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, CreditCard, User, Users } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { storeDb } from '@/lib/tenant/context';
import { SETTING_DEFINITIONS } from '@/lib/settings-definitions';
import { PageHeader } from '@/components/page-header';
import { SettingsForm } from '@/features/admin/settings-form';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requirePermission('settings.view');
  const db = await storeDb();

  const stored = await db.setting.findMany({ where: { group: { not: 'counters' } } });
  const byKey = new Map(stored.map((row) => [row.key, row.value]));

  // Defaults fill any gaps so a fresh install shows a complete, working form.
  const values = Object.fromEntries(
    SETTING_DEFINITIONS.map((definition) => [definition.key, byKey.get(definition.key) ?? definition.value]),
  );

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Settings"
        description="Manage your store, staff and subscription. Several of these settings directly drive the dashboard, alerts, and reports."
      />

      <nav aria-label="Account settings" className="mb-6">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {userCan(user, 'users.view') && (
            <SettingsLink
              href="/settings/users"
              icon={Users}
              title="Staff Accounts"
              description="Add staff, set their role, and reset passwords."
            />
          )}
          <SettingsLink
            href="/settings/profile"
            icon={User}
            title="My Profile"
            description="Your own name, contact details, and password."
          />
          {userCan(user, 'billing.view') && (
            <SettingsLink
              href="/settings/subscription"
              icon={CreditCard}
              title="Subscription & Billing"
              description="Your plan, usage, invoices and payments."
            />
          )}
        </ul>
      </nav>

      <SettingsForm
        definitions={SETTING_DEFINITIONS}
        values={values}
        canEdit={userCan(user, 'settings.update')}
      />
    </div>
  );
}

function SettingsLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Users;
  title: string;
  description: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex h-full items-start gap-3 rounded-card border bg-card p-4 shadow-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-6">{title}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
        </span>
        <ChevronRight
          className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
