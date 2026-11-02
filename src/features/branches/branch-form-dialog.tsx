'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError, FormField, applyServerErrors } from '@/components/form';
import { createBranchAction, updateBranchAction } from '@/features/branches/actions';
import type { BranchListItem } from '@/features/branches/branch-item';

interface FormValues {
  name: string;
  code: string;
  address: string;
}

const EMPTY: FormValues = { name: '', code: '', address: '' };

/**
 * Add or edit a branch. The checks here mirror the server's (actions.ts) so
 * mistakes show on the field at once; the server checks everything again,
 * including the plan's limit and a code already in use.
 */
export function BranchFormDialog({
  target,
  takenCodes,
  onClose,
}: {
  /** 'new', a branch to edit, or null when closed. */
  target: BranchListItem | 'new' | null;
  /** Codes of the store's other branches, for an early duplicate warning. */
  takenCodes: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: EMPTY, mode: 'onTouched' });
  const isNew = target === 'new';
  const editing = target && target !== 'new' ? target : null;

  React.useEffect(() => {
    if (!target) return;
    setFormError(null);
    form.reset(target === 'new' ? EMPTY : { name: target.name, code: target.code, address: target.address ?? '' });
  }, [target, form]);

  const taken = React.useMemo(
    () => new Set(takenCodes.filter((code) => code !== editing?.code).map((code) => code.toUpperCase())),
    [takenCodes, editing?.code],
  );

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const input = { name: values.name.trim(), code: values.code.trim().toUpperCase(), address: values.address.trim() };
    const result = editing ? await updateBranchAction({ ...input, id: editing.id }) : await createBranchAction(input);
    if (!result.ok) {
      setFormError(applyServerErrors(result, form.setError));
      return;
    }
    toast.success(editing ? `${input.name} updated.` : `${input.name} added.`);
    onClose();
    router.refresh();
  });

  const busy = form.formState.isSubmitting;
  const { errors } = form.formState;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add branch' : `Edit ${editing?.name ?? 'branch'}`}</DialogTitle>
          <DialogDescription>
            A branch is one physical store with its own stock, sales and shifts. Any number of devices can be used there.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <FormField id="branch-name" label="Branch name" required error={errors.name}>
            <Input
              id="branch-name"
              autoFocus
              maxLength={60}
              placeholder="e.g. Poblacion Branch"
              aria-invalid={errors.name ? true : undefined}
              {...form.register('name', {
                validate: (value) => {
                  const text = value.trim();
                  if (!text) return 'Enter a branch name.';
                  if (text.length < 2) return 'Use at least 2 characters.';
                  return true;
                },
              })}
            />
          </FormField>
          <FormField
            id="branch-code"
            label="Branch code"
            description={isNew ? 'Short label on receipts and reports. Leave empty and one is chosen for you.' : 'Short label on receipts and reports.'}
            error={errors.code}
          >
            <Input
              id="branch-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              placeholder={isNew ? 'e.g. POB' : undefined}
              className="uppercase"
              aria-invalid={errors.code ? true : undefined}
              {...form.register('code', {
                validate: (value) => {
                  const code = value.trim().toUpperCase();
                  if (!code) return isNew ? true : 'Enter a code.';
                  if (!/^[A-Z0-9-]+$/.test(code)) return 'Use letters, numbers and dashes only.';
                  if (taken.has(code)) return `Another branch already uses the code ${code}.`;
                  return true;
                },
              })}
            />
          </FormField>
          <FormField id="branch-address" label="Address" description="Shown on the branch card. Optional." error={errors.address}>
            <Input id="branch-address" maxLength={200} placeholder="Street, barangay, city" {...form.register('address')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? 'Saving…' : isNew ? 'Add branch' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
