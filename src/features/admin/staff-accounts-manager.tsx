'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { KeyRound, MoreHorizontal, Pencil, Plus, Trash2, UserCheck, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { createUser, deleteUser, resetUserPassword, updateUser } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FormError, FormField } from '@/components/form';
import { validatePassword } from '@/lib/password';
import { initials } from '@/lib/utils';

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  isActive: boolean;
}

interface CreateValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  roleId: string;
}

interface EditValues {
  name: string;
  phone: string;
  roleId: string;
}

interface ResetValues {
  password: string;
  confirmPassword: string;
}

const PASSWORD_HINT = 'At least 10 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.';

/**
 * Staff account management, reached from Settings.
 *
 * The Owner account is created once during first-run setup and is never
 * offered here — this form only ever creates staff. The server enforces that
 * too; hiding the role is convenience, not the control.
 */
export function StaffAccountsManager({
  rows,
  roles,
  currentUserId,
  permissions,
}: {
  rows: StaffRow[];
  roles: { id: string; name: string }[];
  currentUserId: string;
  permissions: { canCreate: boolean; canUpdate: boolean; canDelete: boolean };
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StaffRow | null>(null);
  const [resetting, setResetting] = React.useState<StaffRow | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<StaffRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<StaffRow | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const createForm = useForm<CreateValues>({
    defaultValues: { name: '', email: '', password: '', confirmPassword: '', roleId: roles[0]?.id ?? '' },
  });
  const editForm = useForm<EditValues>({ defaultValues: { name: '', phone: '', roleId: '' } });
  const resetForm = useForm<ResetValues>({ defaultValues: { password: '', confirmPassword: '' } });

  const openCreate = () => {
    setFormError(null);
    createForm.reset({ name: '', email: '', password: '', confirmPassword: '', roleId: roles[0]?.id ?? '' });
    setCreateOpen(true);
  };

  const openEdit = (staff: StaffRow) => {
    setFormError(null);
    editForm.reset({ name: staff.name, phone: staff.phone ?? '', roleId: staff.roleId });
    setEditing(staff);
  };

  const openReset = (staff: StaffRow) => {
    setFormError(null);
    resetForm.reset({ password: '', confirmPassword: '' });
    setResetting(staff);
  };

  const onCreate = createForm.handleSubmit(async (values) => {
    setFormError(null);
    const result = await createUser({
      name: values.name,
      email: values.email,
      password: values.password,
      roleId: values.roleId,
    });

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    toast.success(`${values.name} can now sign in.`);
    setCreateOpen(false);
    router.refresh();
  });

  const onEdit = editForm.handleSubmit(async (values) => {
    if (!editing) return;
    setFormError(null);

    const result = await updateUser(editing.id, { ...values, isActive: editing.isActive });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    toast.success(`${values.name} updated.`);
    setEditing(null);
    router.refresh();
  });

  const onReset = resetForm.handleSubmit(async (values) => {
    if (!resetting) return;
    setFormError(null);

    const result = await resetUserPassword(resetting.id, { password: values.password });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    toast.success(`Password reset. Share the new password with ${resetting.name} securely.`);
    setResetting(null);
    router.refresh();
  });

  const onToggleStatus = async () => {
    if (!statusTarget) return;
    setBusy(true);
    const result = await updateUser(statusTarget.id, {
      name: statusTarget.name,
      phone: statusTarget.phone ?? '',
      roleId: statusTarget.roleId,
      isActive: !statusTarget.isActive,
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      setStatusTarget(null);
      return;
    }

    toast.success(`${statusTarget.name} ${statusTarget.isActive ? 'disabled' : 'enabled'}.`);
    setStatusTarget(null);
    router.refresh();
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const result = await deleteUser(deleteTarget.id);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      setDeleteTarget(null);
      return;
    }

    toast.success(`${deleteTarget.name} removed.`);
    setDeleteTarget(null);
    router.refresh();
  };

  const columns = React.useMemo<ColumnDef<StaffRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <p className="flex items-center gap-1.5 truncate font-medium">
              {row.original.name}
              {row.original.id === currentUserId && <Badge variant="secondary">You</Badge>}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.email}</span>,
      },
      {
        accessorKey: 'roleName',
        header: 'Role',
        cell: ({ row }) => <Badge variant="default">{row.original.roleName}</Badge>,
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'success' : 'destructive'}>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const staff = row.original;
          // The owner cannot disable or delete themselves out of their own
          // store, and only the owner's own Profile page changes their password.
          const canChangeStatus = permissions.canUpdate && !staff.isOwner && staff.id !== currentUserId;
          const canRemove = permissions.canDelete && !staff.isOwner && staff.id !== currentUserId;

          if (!permissions.canUpdate && !canRemove) return null;

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${staff.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {permissions.canUpdate && (
                  <DropdownMenuItem onSelect={() => openEdit(staff)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {permissions.canUpdate && !staff.isOwner && (
                  <DropdownMenuItem onSelect={() => openReset(staff)}>
                    <KeyRound /> Reset Password
                  </DropdownMenuItem>
                )}
                {canChangeStatus && (
                  <DropdownMenuItem onSelect={() => setStatusTarget(staff)}>
                    {staff.isActive ? (
                      <>
                        <UserX /> Disable Account
                      </>
                    ) : (
                      <>
                        <UserCheck /> Enable Account
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {canRemove && (
                  <DropdownMenuItem destructive onSelect={() => setDeleteTarget(staff)}>
                    <Trash2 /> Remove
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, permissions.canUpdate, permissions.canDelete],
  );

  return (
    <>
      {permissions.canCreate && (
        <div className="mb-4 flex justify-end">
          <Button size="lg" onClick={openCreate}>
            <Plus /> Add Staff
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        searchKeys={['name', 'email', 'roleName']}
        searchPlaceholder="Search name, email, or role…"
        emptyState={
          <EmptyState
            icon={Users}
            title="No staff accounts yet"
            description="Add an account for each person who works in your store and give them the role that matches their job."
          />
        }
      />

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Staff Account</DialogTitle>
            <DialogDescription>
              Set a starting password and share it with them securely. They can change it once they sign in.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onCreate} className="space-y-4" noValidate>
            <FormError message={formError} />

            <FormField id="staff-name" label="Full Name" required error={createForm.formState.errors.name}>
              <Input id="staff-name" {...createForm.register('name', { required: 'Enter a name.' })} autoFocus />
            </FormField>

            <FormField id="staff-email" label="Email Address" required error={createForm.formState.errors.email}>
              <Input
                id="staff-email"
                type="email"
                autoComplete="off"
                {...createForm.register('email', { required: 'Enter an email address.' })}
              />
            </FormField>

            <FormField
              id="staff-password"
              label="Password"
              required
              description={PASSWORD_HINT}
              error={createForm.formState.errors.password}
            >
              <Input
                id="staff-password"
                type="text"
                autoComplete="new-password"
                {...createForm.register('password', {
                  required: 'Set a password.',
                  validate: (value) => validatePassword(value).isValid || PASSWORD_HINT,
                })}
              />
            </FormField>

            <FormField
              id="staff-confirm"
              label="Confirm Password"
              required
              error={createForm.formState.errors.confirmPassword}
            >
              <Input
                id="staff-confirm"
                type="text"
                autoComplete="new-password"
                {...createForm.register('confirmPassword', {
                  required: 'Re-enter the password.',
                  validate: (value) => value === createForm.getValues('password') || 'The passwords do not match.',
                })}
              />
            </FormField>

            <FormField id="staff-role" label="Role" required error={createForm.formState.errors.roleId}>
              <Controller
                name="roleId"
                control={createForm.control}
                rules={{ required: 'Choose a role.' }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="staff-role">
                      <SelectValue placeholder="Choose a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createForm.formState.isSubmitting}>
                Create Staff Account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>

          <form onSubmit={onEdit} className="space-y-4" noValidate>
            <FormError message={formError} />

            <FormField id="edit-name" label="Full Name" required error={editForm.formState.errors.name}>
              <Input id="edit-name" {...editForm.register('name', { required: 'Enter a name.' })} />
            </FormField>

            <FormField id="edit-phone" label="Phone">
              <Input id="edit-phone" {...editForm.register('phone')} />
            </FormField>

            <FormField
              id="edit-role"
              label="Role"
              required
              description={editing?.isOwner ? 'The Owner role cannot be changed.' : undefined}
            >
              {editing?.isOwner ? (
                <Input id="edit-role" value={editing.roleName} readOnly disabled />
              ) : (
                <Controller
                  name="roleId"
                  control={editForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="edit-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={editForm.formState.isSubmitting}>
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {resetting?.name} will be signed out everywhere and must sign in again with the new password.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onReset} className="space-y-4" noValidate>
            <FormError message={formError} />

            <FormField
              id="reset-password"
              label="New Password"
              required
              description={PASSWORD_HINT}
              error={resetForm.formState.errors.password}
            >
              <Input
                id="reset-password"
                type="text"
                autoComplete="new-password"
                autoFocus
                {...resetForm.register('password', {
                  required: 'Set a password.',
                  validate: (value) => validatePassword(value).isValid || PASSWORD_HINT,
                })}
              />
            </FormField>

            <FormField
              id="reset-confirm"
              label="Confirm Password"
              required
              error={resetForm.formState.errors.confirmPassword}
            >
              <Input
                id="reset-confirm"
                type="text"
                autoComplete="new-password"
                {...resetForm.register('confirmPassword', {
                  required: 'Re-enter the password.',
                  validate: (value) => value === resetForm.getValues('password') || 'The passwords do not match.',
                })}
              />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetting(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={resetForm.formState.isSubmitting}>
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={statusTarget !== null}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={statusTarget?.isActive ? `Disable ${statusTarget?.name}?` : `Enable ${statusTarget?.name}?`}
        description={
          statusTarget?.isActive
            ? 'They will be signed out immediately and will not be able to sign in until you enable the account again.'
            : 'They will be able to sign in again with their existing password.'
        }
        confirmLabel={statusTarget?.isActive ? 'Disable account' : 'Enable account'}
        loading={busy}
        onConfirm={onToggleStatus}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Remove ${deleteTarget?.name}?`}
        description="Accounts with recorded sales cannot be removed — disable them instead so your sales history stays intact."
        confirmLabel="Remove staff"
        loading={busy}
        onConfirm={onDelete}
      />
    </>
  );
}
