import { requirePermission } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { ResidentForm } from '../resident-form';
import { createResident } from '../actions';

export const metadata = { title: 'Add resident' };

export default async function NewResident({ searchParams }: { searchParams: Promise<{ household?: string }> }) {
  await requirePermission('residents.edit');
  const { household } = await searchParams;
  return (
    <>
      <PageHeader title="Add resident" description="Records of Barangay Inhabitants (RBI)" />
      <ResidentForm action={createResident} defaultHouseholdId={household} />
    </>
  );
}
