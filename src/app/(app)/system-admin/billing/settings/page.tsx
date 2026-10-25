import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { getBillingConfig } from '@/server/platform/billing-service';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { InstructionsForm, PaymentAccountsForm, PriceGrid, TermsForm } from '@/features/platform/billing-settings-form';

export const metadata: Metadata = { title: 'Billing settings' };
export const dynamic = 'force-dynamic';

/**
 * Prices, billing terms and payment instructions. Changing them never alters
 * an issued invoice: each invoice keeps its own amount and terms.
 */
export default async function BillingSettingsPage() {
  await requirePermission('platform.manage');
  const config = await getBillingConfig();

  return (
    <>
      <PageHeader
        title="Billing settings"
        description="What plans cost, the terms owners accept, and how they pay."
        breadcrumbs={[{ label: 'Billing', href: '/system-admin/billing' }, { label: 'Settings' }]}
      />
      <div className="grid gap-4">
        <Panel title="Prices" description="A blank price is not offered to owners. Issued invoices keep the price they were issued at.">
          <PriceGrid prices={config.prices} />
        </Panel>
        <Panel title="Billing terms" description="Versioned. Each invoice keeps a copy of the version the owner accepted.">
          <TermsForm
            current={config.terms ? { ...config.terms, createdAt: config.terms.createdAt.toISOString() } : null}
          />
        </Panel>
        <Panel title="Payment accounts" description="Where owners send their payment. Shown to owners as cards they can copy from.">
          <PaymentAccountsForm current={config.paymentAccounts} />
        </Panel>
        <Panel title="Payment instructions" description="Additional notes shown with the accounts.">
          <InstructionsForm current={config.paymentInstructions} />
        </Panel>
      </div>
    </>
  );
}
