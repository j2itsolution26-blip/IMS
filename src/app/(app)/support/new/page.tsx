import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { SUPPORT_CATEGORIES, type SupportCategory } from '@/lib/support';
import { SUPPORT_MAX_FILES } from '@/lib/support-files';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { TicketForm } from '@/features/support/ticket-form';
import { createSupportTicketAction } from '@/features/support/actions';

export const metadata: Metadata = { title: 'New support ticket' };
export const dynamic = 'force-dynamic';

export default async function NewSupportTicketPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await requirePermission('support.create');
  const { category } = await searchParams;
  const preset = (SUPPORT_CATEGORIES as readonly string[]).includes(category ?? '') ? (category as SupportCategory) : undefined;

  return (
    <>
      <PageHeader
        title="Contact support"
        description="Tell us what you need in your own words. No technical details required."
        breadcrumbs={[{ label: 'Support', href: '/support' }, { label: 'New ticket' }]}
      />
      <Card className="mx-auto max-w-3xl rounded-card p-5 sm:p-6">
        <TicketForm
          variant="app"
          action={createSupportTicketAction}
          maxFiles={SUPPORT_MAX_FILES}
          ticketBasePath="/support/"
          defaultCategory={preset}
        />
      </Card>
    </>
  );
}
