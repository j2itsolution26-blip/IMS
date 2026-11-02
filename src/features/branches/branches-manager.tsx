'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Archive, MapPin, Pencil, Plus, RotateCcw, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError, FormField, applyServerErrors } from '@/components/form';
import { formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { archiveBranchAction, createBranchAction, reactivateBranchAction, updateBranchAction } from '@/features/branches/actions';

export interface BranchListItem {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  /** Active staff assigned to the branch; null where not tracked. */
  staff: number | null;
  /**
   * Active but past the plan's limit after a downgrade: viewable, takes no
   * new shifts, sales or stock until enough branches are archived.
   */
  restricted: boolean;
}

interface FormValues {
  name: string;
  code: string;
  address: string;
}

/**
 * The owner's list of store locations. Buttons follow the plan's room, but
 * the server actions and the database trigger are what enforce it.
 */
export function BranchesManager({
  branches,
  limit,
  planName,
  canManage,
  canUpgrade,
}: {
  branches: BranchListItem[];
  limit: number | null;
  planName: string;
  canManage: boolean;
  canUpgrade: boolean;
}) {
  const router = useRouter();
  const active = branches.filter((branch) => branch.isActive).length;
  const full = limit !== null && active >= limit;
  const over = limit !== null && active > limit;
  const [editing, setEditing] = React.useState<BranchListItem | 'new' | null>(null);
  const [archiving, setArchiving] = React.useState<BranchListItem | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: { name: '', code: '', address: '' } });

  const openForm = (target: BranchListItem | 'new') => {
    setFormError(null);
    form.reset(target === 'new' ? { name: '', code: '', address: '' } : { name: target.name, code: target.code, address: target.address ?? '' });
    setEditing(target);
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = editing === 'new' ? await createBranchAction(values) : await updateBranchAction({ ...values, id: (editing as BranchListItem).id });
    if (!result.ok) {
      setFormError(applyServerErrors(result, form.setError));
      return;
    }
    toast.success(editing === 'new' ? `${values.name} added.` : `${values.name} updated.`);
    setEditing(null);
    router.refresh();
  });

  const reactivate = async (branch: BranchListItem) => {
    setBusy(true);
    const result = await reactivateBranchAction({ id: branch.id });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    toast.success(`${branch.name} is active again.`);
    router.refresh();
  };

  const archive = async () => {
    if (!archiving) return;
    setBusy(true);
    const result = await archiveBranchAction({ id: archiving.id });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    toast.success(`${archiving.name} archived. Its history is kept.`);
    setArchiving(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="branch-allowance-title"
        className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border bg-card p-3 text-sm', over && 'border-warning/50 bg-warning/5')}
      >
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="branch-allowance-title" className="font-medium">
            Locations
          </h2>
          <span className="text-xs text-muted-foreground">{planName} plan · a location is a physical store, not a device</span>
        </div>
        <Badge variant={full ? 'warning' : 'secondary'}>
          {formatNumber(active, 0)}
          {limit !== null ? ` of ${formatNumber(limit, 0)}` : ''} active
        </Badge>
        {over && (
          <p className="basis-full text-xs text-warning-text">
            Your plan allows {limit} active {limit === 1 ? 'location' : 'locations'}. Archive {active - (limit ?? 0)} to stay within it, choosing which ones to keep. Until then you cannot add or
            reactivate branches, and the branches marked “Over plan limit” (the newest ones) take no new sales, shifts or stock. The main branch always keeps working. Nothing is deleted.
          </p>
        )}
        {full && !over && (
          <p className="basis-full text-xs text-muted-foreground">
            You are using every location on your plan.{' '}
            {canUpgrade ? (
              <Link href="/settings/subscription#plans" className="font-medium text-primary hover:underline">
                Upgrade for more
              </Link>
            ) : (
              'Ask the owner to upgrade for more.'
            )}
          </p>
        )}
        {canManage && (
          <Button className="ml-auto" size="sm" onClick={() => openForm('new')} disabled={full} title={full ? 'Your plan has no free locations' : undefined}>
            <Plus aria-hidden="true" /> Add branch
          </Button>
        )}
      </section>

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {branches.map((branch) => (
          <li key={branch.id} className={cn('flex flex-col gap-3 rounded-card border bg-card p-4', !branch.isActive && 'opacity-75')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{branch.name}</p>
                <p className="text-xs text-muted-foreground">Code {branch.code}</p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {branch.isDefault && <Badge variant="info">Main</Badge>}
                {branch.restricted ? (
                  <Badge variant="warning">Over plan limit</Badge>
                ) : (
                  <Badge variant={branch.isActive ? 'success' : 'secondary'}>{branch.isActive ? 'Active' : 'Archived'}</Badge>
                )}
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {branch.address || 'No address yet'}
            </p>
            <p className="text-xs text-muted-foreground">
              {branch.staff !== null && `${formatNumber(branch.staff, 0)} staff assigned · `}added {formatDate(branch.createdAt)}
            </p>
            {canManage && (
              <div className="mt-auto flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openForm(branch)}>
                  <Pencil aria-hidden="true" /> Edit
                </Button>
                {branch.isActive && !branch.isDefault && (
                  <Button variant="outline" size="sm" onClick={() => setArchiving(branch)}>
                    <Archive aria-hidden="true" /> Archive
                  </Button>
                )}
                {!branch.isActive && (
                  <Button variant="outline" size="sm" disabled={busy || full} onClick={() => reactivate(branch)} title={full ? 'Your plan has no free locations' : undefined}>
                    <RotateCcw aria-hidden="true" /> Reactivate
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Add branch' : `Edit ${editing?.name ?? ''}`}</DialogTitle>
            <DialogDescription>A branch is one physical store. Any number of devices can be used there.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={formError} />
            <FormField id="branch-name" label="Branch name" required error={form.formState.errors.name}>
              <Input id="branch-name" autoFocus {...form.register('name', { required: 'Enter a branch name.' })} />
            </FormField>
            <FormField id="branch-code" label="Code" description="Short label on receipts and reports. Left empty, one is chosen for you." error={form.formState.errors.code}>
              <Input id="branch-code" autoCapitalize="characters" maxLength={12} {...form.register('code')} />
            </FormField>
            <FormField id="branch-address" label="Address" error={form.formState.errors.address}>
              <Input id="branch-address" maxLength={200} {...form.register('address')} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : editing === 'new' ? 'Add branch' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={`Archive ${archiving?.name ?? ''}?`}
        description="Its sales, stock and shift history are kept and still appear in reports. It stops taking new sales and stock, and frees a location on your plan. You can reactivate it later."
        confirmLabel="Archive"
        loading={busy}
        loadingLabel="Archiving…"
        icon={Archive}
        onConfirm={archive}
      />
    </div>
  );
}
