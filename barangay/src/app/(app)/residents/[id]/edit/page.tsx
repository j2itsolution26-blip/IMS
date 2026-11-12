import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { fullName } from '@/lib/format';
import { PageHeader } from '@/components/ui';
import { ResidentForm } from '../../resident-form';
import { updateResident } from '../../actions';

export const metadata = { title: 'Edit resident' };

export default async function EditResident({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('residents.edit');
  const { id } = await params;
  const resident = await prisma.resident.findUnique({ where: { id } });
  if (!resident) notFound();
  return (
    <>
      <PageHeader title={`Edit ${fullName(resident)}`} />
      <ResidentForm action={updateResident} resident={resident} />
    </>
  );
}
