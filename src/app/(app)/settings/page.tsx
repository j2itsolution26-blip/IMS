import type { Metadata } from 'next';
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
      <SettingsForm
        definitions={SETTING_DEFINITIONS}
        values={values}
        canEdit={userCan(user, 'settings.update')}
      />
    </>
  );
}
