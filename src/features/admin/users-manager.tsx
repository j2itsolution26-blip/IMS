'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { createUser, deleteUser, updateUser } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch, Avatar, AvatarFallback } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FormError, FormField } from '@/components/form';
import { formatRelative } from '@/lib/format';
import { initials } from '@/lib/utils';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  roleName: string;
  roleSlug: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

interface CreateValues {
  name: string;
  email: string;
  password: string;
  roleId: string;
  phone: string;
}

interface EditValues {
  name: string;
  roleId: string;
  phone: string;
  isActive: boolean;
}

/**
 * User administration.
 *
 * New accounts are created through Better Auth so passwords are hashed by the
 * same code path as sign-in. There is no "reset password" here yet — an admin
 * creates the account with a starting password and the user changes it.
 */
export function UsersManager({
  rows,
  roles,
  currentUserId,
  permissions,
}: {
  rows: UserRow[];
  roles: { id: string; name: string; slug: string }[];
  currentUserId: string;
  permissions: { canCreate: boolean; canUpdate: boolean; canDelete: boolean };
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const createForm = useForm<CreateValues>({
    defaultValues: { name: '', email: '', password: '', roleId: roles[0]?.id ?? '', phone: '' },
  });

  const editForm = useForm<EditValues>({
    defaultValues: { name: '', roleId: '', phone: '', isActive: true },
  });

  const openEdit = (user: UserRow) => {
    setFormError(null);
    editForm.reset({
      name: user.name,
      roleId: user.roleId,
      phone: user.phone ?? '',
      isActive: user.isActive,
    });
    setEditing(user);
  };

  const onCreate = createForm.handleSubmit(async (values) => {
    setFormError(null);
    const result = await createUser(values);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    toast.success(`${values.name} can now sign in.`);
    setCreateOpen(false);
    createForm.reset({ name: '', email: '', password: '', roleId: roles[0]?.id ?? '', phone: '' });
    router.refresh();
  });

  const onEdit = editForm.handleSubmit(async (values) => {
    if (!editing) return;
    setFormError(null);

    const result = await updateUser(editing.id, values);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    toast.success(`${values.name} updated.`);
    setEditing(null);
    router.refresh();
  });

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteUser(deleteTarget.id);
    setDeleting(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      setDeleteTarget(null);
      return;
    }

    toast.success(`${deleteTarget.name} deleted.`);
    setDeleteTarget(null);
    router.refresh();
  };

  const columns = React.useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'User',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-medium">
                {row.original.name}
                {row.original.id === currentUserId && <Badge variant="secondary">You</Badge>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'roleName',
        header: 'Role',
        cell: ({ row }) => <Badge variant="default">{row.original.roleName}</Badge>,
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.phone ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'lastLoginAt',
        header: 'Last signed in',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.lastLoginAt ? formatRelative(row.original.lastLoginAt) : 'never'}
          </span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'success' : 'destructive'}>
            {row.original.isActive ? 'Active' : 'Deactivated'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          permissions.canUpdate || permissions.canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {permissions.canUpdate && (
                  <DropdownMenuItem onSelect={() => openEdit(row.original)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {permissions.canDelete && row.original.id !== currentUserId && (
                  <DropdownMenuItem destructive onSelect={() => setDeleteTarget(row.original)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, permissions.canUpdate, permissions.canDelete],
  );

  return (
    <>
      {permissions.canCreate && (
        <div className="mb-4 flex justify-end">
          <Button
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
          >
            <Plus /> New user
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
            title="No users"
            description="Add staff accounts and assign each one a role that matches what they need to do."
          />
        }
      />

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              Set a starting password and share it with them securely. They can change it after signing in.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onCreate} className="space-y-4" noValidate>
            <FormError message={formError} />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="new-name" label="Full name" required error={createForm.formState.errors.name}>
                <Input id="new-name" {...createForm.register('name', { required: 'Enter a name.' })} />
              </FormField>

              <FormField id="new-email" label="Email" required error={createForm.formState.errors.email}>
                <Input
                  id="new-email"
                  type="email"
                  {...createForm.register('email', { required: 'Enter an email address.' })}
                />
              </FormField>

              <FormField
                id="new-password"
                label="Starting password"
                required
                description="At least 10 characters, with upper, lower, and a number."
                error={createForm.formState.errors.password}
                className="sm:col-span-2"
              >
                <Input
                  id="new-password"
                  type="text"
                  autoComplete="new-password"
                  {...createForm.register('password', { required: 'Set a password.' })}
                />
              </FormField>

              <FormField id="new-role" label="Role" required error={createForm.formState.errors.roleId}>
                <Controller
                  name="roleId"
                  control={createForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="new-role">
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
              </FormField>

              <FormField id="new-phone" label="Phone">
                <Input id="new-phone" {...createForm.register('phone')} />
              </FormField>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createForm.formState.isSubmitting}>
                Create user
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="edit-name" label="Full name" required>
                <Input id="edit-name" {...editForm.register('name', { required: true })} />
              </FormField>

              <FormField id="edit-phone" label="Phone">
                <Input id="edit-phone" {...editForm.register('phone')} />
              </FormField>

              <FormField id="edit-role" label="Role" required className="sm:col-span-2">
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
              </FormField>

              <div className="flex items-start justify-between gap-4 rounded-md border p-3 sm:col-span-2">
                <div>
                  <Label htmlFor="edit-active">Account active</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Deactivating signs them out everywhere immediately and blocks sign-in.
                  </p>
                </div>
                <Controller
                  name="isActive"
                  control={editForm.control}
                  render={({ field }) => (
                    <Switch
                      id="edit-active"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={editing?.id === currentUserId}
                    />
                  )}
                />
              </div>
            </div>

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

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="Accounts with any recorded transactions cannot be deleted — deactivate them instead so the audit trail stays intact."
        confirmLabel="Delete user"
        loading={deleting}
        onConfirm={onDelete}
      />
    </>
  );
}
