'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { updateOwnProfile } from '@/features/admin/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormError } from '@/components/form';

interface ProfileValues {
  name: string;
  phone: string;
}

export function ProfileForm({
  email,
  roleName,
  defaultValues,
}: {
  email: string;
  roleName: string;
  defaultValues: ProfileValues;
}) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileValues>({ defaultValues });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await updateOwnProfile(values);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    toast.success('Profile updated.');
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="profile-name" label="Full name" required error={errors.name}>
          <Input id="profile-name" {...register('name', { required: 'Enter your name.', minLength: 2 })} />
        </FormField>

        <FormField id="profile-phone" label="Phone">
          <Input id="profile-phone" {...register('phone')} />
        </FormField>

        {/* Read-only: changing either is an administrative action. */}
        <FormField id="profile-email" label="Email" description="Managed by an administrator.">
          <Input id="profile-email" value={email} readOnly disabled />
        </FormField>

        <FormField id="profile-role" label="Role" description="Managed by an administrator.">
          <Input id="profile-role" value={roleName} readOnly disabled />
        </FormField>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
