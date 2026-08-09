'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { createRole, deleteRole, updateRolePermissions } from '@/features/admin/actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/misc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/form';
import { cn } from '@/lib/utils';

export interface RoleRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

interface PermissionMeta {
  key: string;
  resource: string;
  action: string;
}

/**
 * Role editor.
 *
 * Permissions are grouped by resource so granting "everything about products"
 * is one click rather than five. The Owner role is deliberately read-only — it
 * is the recovery path if another role is misconfigured.
 */
export function RolesManager({
  roles,
  allPermissions,
  permissions: can,
}: {
  roles: RoleRow[];
  allPermissions: PermissionMeta[];
  permissions: { canCreate: boolean; canUpdate: boolean; canDelete: boolean };
}) {
  const router = useRouter();

  const [selectedId, setSelectedId] = React.useState(roles[0]?.id ?? '');
  const [draft, setDraft] = React.useState<Set<string>>(new Set(roles[0]?.permissions ?? []));
  const [saving, setSaving] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = React.useState<RoleRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const selected = roles.find((role) => role.id === selectedId) ?? roles[0];
  const isOwner = selected?.slug === 'owner';
  const editable = can.canUpdate && !isOwner;

  const select = (role: RoleRow) => {
    setSelectedId(role.id);
    setDraft(new Set(role.permissions));
  };

  const grouped = React.useMemo(() => {
    const map = new Map<string, PermissionMeta[]>();
    for (const permission of allPermissions) {
      const list = map.get(permission.resource) ?? [];
      list.push(permission);
      map.set(permission.resource, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allPermissions]);

  const dirty =
    selected &&
    (draft.size !== selected.permissions.length ||
      selected.permissions.some((key) => !draft.has(key)));

  const toggle = (key: string) =>
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleResource = (resource: string, on: boolean) =>
    setDraft((current) => {
      const next = new Set(current);
      for (const permission of allPermissions) {
        if (permission.resource !== resource) continue;
        if (on) next.add(permission.key);
        else next.delete(permission.key);
      }
      return next;
    });

  const onSave = async () => {
    if (!selected) return;
    setSaving(true);
    const result = await updateRolePermissions(selected.id, [...draft]);
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`${selected.name} now has ${result.data} permission(s).`);
    router.refresh();
  };

  const onCreate = async () => {
    setCreating(true);
    setFormError(null);

    const result = await createRole({
      name: newName,
      description: newDescription,
      // A new role starts with read access only — widening is a deliberate act.
      permissions: allPermissions.filter((p) => p.action === 'view').map((p) => p.key),
    });
    setCreating(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    toast.success(`${newName} created with view-only access. Adjust its permissions below.`);
    setCreateOpen(false);
    setNewName('');
    setNewDescription('');
    router.refresh();
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteRole(deleteTarget.id);
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

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          {can.canCreate && (
            <Button className="w-full" onClick={() => setCreateOpen(true)}>
              <Plus /> New role
            </Button>
          )}

          <ul className="space-y-1.5">
            {roles.map((role) => (
              <li key={role.id}>
                <button
                  type="button"
                  onClick={() => select(role)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    role.id === selected?.id
                      ? 'border-primary/50 bg-primary/5'
                      : 'hover:border-primary/30 hover:bg-accent/40',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{role.name}</span>
                    {role.isSystem && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Built-in" />}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {role.userCount} user{role.userCount === 1 ? '' : 's'}
                    <span aria-hidden="true">·</span>
                    {role.slug === 'owner' ? 'all permissions' : `${role.permissions.length} permissions`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected && (
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                  {selected.name}
                  {selected.isSystem && <Badge variant="secondary">Built-in</Badge>}
                </CardTitle>
                <CardDescription>
                  {selected.description ?? 'No description.'}
                </CardDescription>
              </div>

              {can.canDelete && !selected.isSystem && (
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(selected)} aria-label="Delete role">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>

            <CardContent className="space-y-4">
              {isOwner && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  The Owner role always has full access and cannot be restricted. This is deliberate — it is
                  how you recover if another role is misconfigured.
                </p>
              )}

              <div className="space-y-3">
                {grouped.map(([resource, items]) => {
                  const granted = items.filter((item) => isOwner || draft.has(item.key)).length;
                  const allOn = granted === items.length;

                  return (
                    <div key={resource} className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-medium capitalize">{resource}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {granted}/{items.length}
                          </span>
                          {editable && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() => toggleResource(resource, !allOn)}
                            >
                              {allOn ? 'Clear' : 'Select all'}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {items.map((item) => (
                          <label
                            key={item.key}
                            className={cn(
                              'flex items-center gap-1.5 text-sm',
                              editable ? 'cursor-pointer' : 'cursor-default opacity-80',
                            )}
                          >
                            <Checkbox
                              checked={isOwner || draft.has(item.key)}
                              disabled={!editable}
                              onCheckedChange={() => toggle(item.key)}
                              aria-label={`${item.action} ${resource}`}
                            />
                            <span className="capitalize">{item.action}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {editable && (
                <div className="sticky bottom-4 flex justify-end">
                  <Button onClick={onSave} loading={saving} disabled={!dirty}>
                    {dirty ? 'Save permissions' : 'No changes'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>
              The role starts with view-only access to everything. Grant the rest once it exists.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <FormError message={formError} />

            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Warehouse supervisor"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                rows={2}
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="What is this role for?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onCreate} loading={creating} disabled={newName.trim().length < 2}>
              Create role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="Roles that still have users assigned cannot be deleted. Reassign those users first."
        confirmLabel="Delete role"
        loading={deleting}
        onConfirm={onDelete}
      />
    </>
  );
}
