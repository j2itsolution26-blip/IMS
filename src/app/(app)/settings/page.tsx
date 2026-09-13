import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, User, Users } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { SETTING_DEFINITIONS } from '@/lib/settings-definitions';
import { PageHeader } from '@/components/page-header';
import { SettingsForm } from '@/features/admin/settings-form';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requirePermission('settings.view');

  const stored = await prisma.setting.findMany({ where: { group: { not: 'counters' } } });
  const byKey = new Map(stored.map((row) => [row.key, row.value]));

  // Defaults fill any gaps so a fresh install shows a complete, working form.
  const values = Object.fromEntries(
    SETTING_DEFINITIONS.map((definition) => [definition.key, byKey.get(definition.key) ?? definition.value]),
  );

  return (
    <>
      <PageHeader
        title="Settings"
        description="System configuration. Several of these directly drive the dashboard, alerts, and reports."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
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
      </div>

      <SettingsForm
        definitions={SETTING_DEFINITIONS}
        values={values}
        canEdit={userCan(user, 'settings.update')}
      />
    </>
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
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
