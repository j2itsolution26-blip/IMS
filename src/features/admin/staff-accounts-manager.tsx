'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { Fingerprint, KeyRound, MoreHorizontal, Pencil, Plus, Trash2, UserCheck, UserX, Users, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { createUser, deleteUser, resetUserPassword, revokeUserPasskeys, setUserStatus, updateUser } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, Checkbox } from '@/components/ui/misc';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/format';
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
import { generatePassword, validatePassword } from '@/lib/password';
import { USERNAME_HINT, normalizeUsername, usernameProblem } from '@/lib/username';
import { initials } from '@/lib/utils';

export interface StaffRow {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  isActive: boolean;
  /** The drawer this person has open right now, if any. */
  openShift: { id: string; reference: string; openedAt: string } | null;
  /** The latest Deactivated / Reactivated audit entry: who, when and why. */
  lastStatusChange: { summary: string; at: string; by: string | null } | null;
  /**
   * What the signed-in user may do to this account, decided on the server by
   * the same policy the actions enforce.
   */
  actions: {
    edit: boolean;
    changeRole: boolean;
    changeStatus: boolean;
    resetPassword: boolean;
    remove: boolean;
  };
}

interface CreateValues {
  name: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  roleId: string;
  status: 'active' | 'inactive';
}

interface EditValues {
  name: string;
  username: string;
  phone: string;
  roleId: string;
}

/** react-hook-form rule shared by the create and edit dialogs. */
const usernameRules = {
  required: 'Enter a username.',
  validate: (value: string) => usernameProblem(normalizeUsername(value)) ?? true,
};

interface ResetValues {
  password: string;
  confirmPassword: string;
}

const PASSWORD_HINT = 'At least 10 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.';

const emptyCreate = (roles: { id: string }[]): CreateValues => ({
  name: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  roleId: roles[0]?.id ?? '',
  status: 'active',
});

/**
 * Staff account management, reached from Settings.
 *
 * The Owner account is created by the System Administrator and is never
 * offered here — this form only ever creates staff. System Administrator
 * accounts are not listed at all. The server enforces both; hiding a row or a
 * menu item is convenience, not the control.
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
  const [passkeyTarget, setPasskeyTarget] = React.useState<StaffRow | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [statusReason, setStatusReason] = React.useState('');
  const [leaveShiftOpen, setLeaveShiftOpen] = React.useState(false);

  const createForm = useForm<CreateValues>({
    defaultValues: emptyCreate(roles),
  });
  const editForm = useForm<EditValues>({ defaultValues: { name: '', username: '', phone: '', roleId: '' } });
  const resetForm = useForm<ResetValues>({ defaultValues: { password: '', confirmPassword: '' } });

  const openCreate = () => {
    setFormError(null);
    createForm.reset(emptyCreate(roles));
    setCreateOpen(true);
  };

  // The role select is only offered when the server would accept a change and
  // the account's current role is one this user may assign.
  const roleEditable = (staff: StaffRow) =>
    staff.actions.changeRole && roles.some((role) => role.id === staff.roleId);

  const openEdit = (staff: StaffRow) => {
    setFormError(null);
    editForm.reset({ name: staff.name, username: staff.username, phone: staff.phone ?? '', roleId: staff.roleId });
    setEditing(staff);
  };

  const openReset = (staff: StaffRow) => {
    setFormError(null);
    resetForm.reset({ password: '', confirmPassword: '' });
    setResetting(staff);
  };

  const onCreate = createForm.handleSubmit(async (values) => {
    setFormError(null);
    const username = normalizeUsername(values.username);
    const result = await createUser({
      name: values.name,
      username,
      email: values.email,
      password: values.password,
      roleId: values.roleId,
      isActive: values.status === 'active',
    });

    if (!result.ok) {
      setFormError(result.error);
      // Put a server-side field error (such as a taken username) on its field.
      for (const field of ['username', 'email', 'password'] as const) {
        const message = result.fieldErrors?.[field]?.[0];
        if (message) createForm.setError(field, { message });
      }
      return;
    }

    toast.success(
      values.status === 'active'
        ? `${values.name} can now sign in as ${username}.`
        : `Account for ${values.name} created as inactive.`,
    );
    setCreateOpen(false);
    router.refresh();
  });

  const onEdit = editForm.handleSubmit(async (values) => {
    if (!editing) return;
    setFormError(null);

    const result = await updateUser(editing.id, {
      ...values,
      username: normalizeUsername(values.username),
      isActive: editing.isActive,
    });
    if (!result.ok) {
      setFormError(result.error);
      const message = result.fieldErrors?.username?.[0];
      if (message) editForm.setError('username', { message });
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

  const openStatus = (staff: StaffRow) => {
    setStatusReason('');
    setLeaveShiftOpen(false);
    setStatusTarget(staff);
  };

  const onToggleStatus = async () => {
    if (!statusTarget || busy) return;
    setBusy(true);
    const result = await setUserStatus(statusTarget.id, {
      isActive: !statusTarget.isActive,
      reason: statusReason.trim() || undefined,
      leaveShiftOpen,
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`${statusTarget.name} ${statusTarget.isActive ? 'disabled and signed out' : 'enabled'}.`);
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

  const onRevokePasskeys = async () => {
    if (!passkeyTarget) return;
    setBusy(true);
    const result = await revokeUserPasskeys(passkeyTarget.id);
    setBusy(false);
    const name = passkeyTarget.name;
    setPasskeyTarget(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.removed === 0
        ? `${name} had no passkeys.`
        : `Removed ${result.data.removed} passkey${result.data.removed === 1 ? '' : 's'} for ${name}.`,
    );
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
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.username}</span>,
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
        cell: ({ row }) => {
          const staff = row.original;
          return (
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={staff.isActive ? 'success' : 'destructive'}>{staff.isActive ? 'Active' : 'Inactive'}</Badge>
                {staff.openShift && <Badge variant="warning">Shift {staff.openShift.reference} open</Badge>}
              </div>
              {staff.lastStatusChange && (
                <p className="max-w-[260px] truncate text-xs text-muted-foreground" title={staff.lastStatusChange.summary}>
                  {formatDateTime(staff.lastStatusChange.at)}
                  {staff.lastStatusChange.by ? ` · ${staff.lastStatusChange.by}` : ''}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const staff = row.original;
          // Nobody disables, removes or resets their own account from here —
          // the owner's password changes from their Profile page — and the
          // Owner row is otherwise managed by the System Administrator.
          const { edit, changeStatus, resetPassword, remove } = staff.actions;

          if (!edit && !changeStatus && !resetPassword && !remove) return null;

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${staff.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {edit && (
                  <DropdownMenuItem onSelect={() => openEdit(staff)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {resetPassword && (
                  <DropdownMenuItem onSelect={() => openReset(staff)}>
                    <KeyRound /> Reset Password
                  </DropdownMenuItem>
                )}
                {resetPassword && (
                  <DropdownMenuItem onSelect={() => setPasskeyTarget(staff)}>
                    <Fingerprint /> Revoke Passkeys
                  </DropdownMenuItem>
                )}
                {changeStatus && (
                  <DropdownMenuItem onSelect={() => openStatus(staff)}>
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
                {remove && (
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
    [currentUserId],
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
        searchKeys={['name', 'username', 'email', 'roleName']}
        searchPlaceholder="Search name, username, email, or role…"
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

            <FormField
              id="staff-username"
              label="Username"
              required
              description={`${USERNAME_HINT} They sign in with this or their email.`}
              error={createForm.formState.errors.username}
            >
              <Input
                id="staff-username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                {...createForm.register('username', usernameRules)}
              />
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
              <div className="flex gap-2">
                <Input
                  id="staff-password"
                  type="text"
                  autoComplete="new-password"
                  className="font-mono"
                  {...createForm.register('password', {
                    required: 'Set a password.',
                    validate: (value) => validatePassword(value).isValid || PASSWORD_HINT,
                  })}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    const password = generatePassword();
                    createForm.setValue('password', password, { shouldValidate: true });
                    createForm.setValue('confirmPassword', password, { shouldValidate: true });
                  }}
                >
                  <Wand2 /> Generate
                </Button>
              </div>
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

            <FormField
              id="staff-status"
              label="Account Status"
              required
              description="An inactive account exists but cannot sign in until you enable it."
            >
              <Controller
                name="status"
                control={createForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="staff-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
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

            <FormField
              id="edit-username"
              label="Username"
              required
              description={USERNAME_HINT}
              error={editForm.formState.errors.username}
            >
              <Input
                id="edit-username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                {...editForm.register('username', usernameRules)}
              />
            </FormField>

            <FormField id="edit-phone" label="Phone">
              <Input id="edit-phone" {...editForm.register('phone')} />
            </FormField>

            <FormField
              id="edit-role"
              label="Role"
              required
              description={
                editing?.isOwner
                  ? 'The Owner role cannot be changed.'
                  : editing && !roleEditable(editing)
                    ? 'You cannot change the role of this account.'
                    : undefined
              }
            >
              {editing && !roleEditable(editing) ? (
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

      <Dialog open={statusTarget !== null} onOpenChange={(open) => !open && !busy && setStatusTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{statusTarget?.isActive ? `Disable ${statusTarget?.name}?` : `Enable ${statusTarget?.name}?`}</DialogTitle>
            <DialogDescription>
              {statusTarget?.isActive
                ? 'They are signed out on every device at once and cannot sign in until you enable the account again. Their sales, shifts and stock records keep their name.'
                : 'They can sign in again with their existing password. This uses one of the active staff accounts on your plan.'}
            </DialogDescription>
          </DialogHeader>

          {statusTarget?.isActive && statusTarget.openShift && (
            <div role="alert" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium text-warning-text">
                {statusTarget.name} has shift {statusTarget.openShift.reference} open since{' '}
                {formatDateTime(statusTarget.openShift.openedAt)}.
              </p>
              <p className="text-muted-foreground">
                The drawer still holds that shift&apos;s cash. Best: count it and{' '}
                <Link href={`/shifts/${statusTarget.openShift.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  close the shift
                </Link>{' '}
                first. If you must lock them out now, the shift stays open for you to close.
              </p>
              <label htmlFor="leave-shift-open" className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  id="leave-shift-open"
                  checked={leaveShiftOpen}
                  onCheckedChange={(checked) => setLeaveShiftOpen(checked === true)}
                  className="mt-0.5"
                />
                <span>Disable now and leave {statusTarget.openShift.reference} open for me to close.</span>
              </label>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="status-reason">
              Reason <span className="font-normal text-muted-foreground">(optional, kept in the audit log)</span>
            </Label>
            <Input
              id="status-reason"
              value={statusReason}
              maxLength={200}
              onChange={(event) => setStatusReason(event.target.value)}
              placeholder={statusTarget?.isActive ? 'e.g. Left the store, lost phone' : 'e.g. Back from leave'}
            />
          </div>

          {statusTarget?.lastStatusChange && (
            <p className="text-xs text-muted-foreground">
              Last change: {statusTarget.lastStatusChange.summary} ({formatDateTime(statusTarget.lastStatusChange.at)}
              {statusTarget.lastStatusChange.by ? `, by ${statusTarget.lastStatusChange.by}` : ''})
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={statusTarget?.isActive ? 'destructive' : 'default'}
              onClick={onToggleStatus}
              loading={busy}
              disabled={Boolean(statusTarget?.isActive && statusTarget.openShift && !leaveShiftOpen)}
            >
              {statusTarget?.isActive ? 'Disable account' : 'Enable account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Remove ${deleteTarget?.name}?`}
        description="Accounts with recorded sales cannot be removed — disable them instead so your sales history stays intact."
        confirmLabel="Remove staff"
        loading={busy}
        onConfirm={onDelete}
      />

      <ConfirmDialog
        open={passkeyTarget !== null}
        onOpenChange={(open) => !open && setPasskeyTarget(null)}
        title={`Revoke ${passkeyTarget?.name}'s passkeys?`}
        description="Every passkey on this account stops working and they are signed out everywhere. Their account and password are not changed, and they can add a new passkey after signing in with their password."
        confirmLabel="Revoke passkeys"
        destructive
        loading={busy}
        onConfirm={onRevokePasskeys}
      />
    </>
  );
}
