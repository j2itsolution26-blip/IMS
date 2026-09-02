'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller, type DefaultValues, type FieldValues, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { LucideIcon } from 'lucide-react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
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
import { DataTable } from '@/components/data-table';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { FormField, FormError, applyServerErrors } from '@/components/form';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/action';
import type { ColumnDef } from '@tanstack/react-table';

/**
 * One implementation for both reference entities.
 *
 * Categories and units are the same screen with different fields: a table, a
 * create/edit dialog, and a guarded delete. Describing the fields as data
 * means adding an entity is a config object rather than another 150 lines of
 * near-identical JSX.
 *
 * Products, sales, and returns are deliberately not built this way — they
 * have real domain behaviour that a generic form cannot express.
 */

export type FieldSpec<T extends FieldValues> =
  | { kind: 'text'; name: Path<T>; label: string; placeholder?: string; description?: string; required?: boolean; uppercase?: boolean; colSpan?: 1 | 2 }
  | { kind: 'textarea'; name: Path<T>; label: string; description?: string; required?: boolean; rows?: number; colSpan?: 1 | 2 }
  | { kind: 'number'; name: Path<T>; label: string; step?: string; min?: number; max?: number; description?: string; required?: boolean; colSpan?: 1 | 2 }
  | { kind: 'switch'; name: Path<T>; label: string; description?: string; colSpan?: 1 | 2 }
  | {
      kind: 'select';
      name: Path<T>;
      label: string;
      description?: string;
      required?: boolean;
      options: { value: string; label: string }[];
      emptyOption?: { value: string; label: string };
      colSpan?: 1 | 2;
    };

export interface ResourceManagerProps<TRow extends { id: string }, TValues extends FieldValues> {
  rows: TRow[];
  columns: ColumnDef<TRow, unknown>[];
  /** Fields the table's search box matches against. */
  searchKeys?: (keyof TRow)[];
  searchPlaceholder?: string;

  schema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  fields: FieldSpec<TValues>[];
  emptyValues: DefaultValues<TValues>;
  /** Maps a table row back to form values when editing. */
  toFormValues: (row: TRow) => DefaultValues<TValues>;

  singular: string;
  plural: string;
  /** Name shown in dialogs and toasts, e.g. row.name. */
  displayName: (row: TRow) => string;

  emptyIcon: LucideIcon;
  emptyDescription: string;

  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;

  onCreate: (values: unknown) => Promise<ActionResult<{ id: string }>>;
  onUpdate: (id: string, values: unknown) => Promise<ActionResult<{ id: string }>>;
  onDelete: (id: string) => Promise<ActionResult<void>>;
}

export function ResourceManager<TRow extends { id: string }, TValues extends FieldValues>({
  rows,
  columns,
  searchKeys,
  searchPlaceholder,
  schema,
  fields,
  emptyValues,
  toFormValues,
  singular,
  plural,
  displayName,
  emptyIcon,
  emptyDescription,
  canCreate,
  canUpdate,
  canDelete,
  onCreate,
  onUpdate,
  onDelete,
}: ResourceManagerProps<TRow, TValues>) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<TRow | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<TRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TValues>({
    resolver: zodResolver(schema as never),
    defaultValues: emptyValues,
  });

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset(emptyValues);
    setDialogOpen(true);
  };

  const openEdit = (row: TRow) => {
    setEditing(row);
    setFormError(null);
    reset(toFormValues(row));
    setDialogOpen(true);
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = editing ? await onUpdate(editing.id, values) : await onCreate(values);

    if (!result.ok) {
      setFormError(applyServerErrors<TValues>(result, setError));
      return;
    }

    toast.success(editing ? `${singular} updated.` : `${singular} created.`);
    setDialogOpen(false);
    router.refresh();
  });

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await onDelete(deleteTarget.id);
    setDeleting(false);

    if (!result.ok) {
      // Delete guards explain exactly what is still referencing the record.
      toast.error(result.error, { duration: 8000 });
      setDeleteTarget(null);
      return;
    }

    toast.success(`${displayName(deleteTarget)} deleted.`);
    setDeleteTarget(null);
    router.refresh();
  };

  // The actions column is appended here so each caller does not rebuild it.
  const allColumns = React.useMemo<ColumnDef<TRow, unknown>[]>(() => {
    if (!canUpdate && !canDelete) return columns;

    return [
      ...columns,
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${displayName(row.original)}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdate && (
                <DropdownMenuItem onSelect={() => openEdit(row.original)}>
                  <Pencil /> Edit
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem destructive onSelect={() => setDeleteTarget(row.original)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, canUpdate, canDelete]);

  return (
    <>
      {canCreate && (
        <div className="mb-4 flex justify-end">
          <Button onClick={openCreate}>
            <Plus /> New {singular.toLowerCase()}
          </Button>
        </div>
      )}

      <DataTable
        columns={allColumns}
        data={rows}
        searchKeys={searchKeys}
        searchPlaceholder={searchPlaceholder ?? `Search ${plural.toLowerCase()}…`}
        emptyState={
          <EmptyState
            icon={emptyIcon}
            title={`No ${plural.toLowerCase()} yet`}
            description={emptyDescription}
            action={
              canCreate && (
                <Button onClick={openCreate}>
                  <Plus /> Add {singular.toLowerCase()}
                </Button>
              )
            }
          />
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? `Update the details for ${displayName(editing)}.`
                : `Add a new ${singular.toLowerCase()} to your ${plural.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormError message={formError} />

            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => {
                const id = String(field.name);
                const error = errors[field.name as keyof typeof errors] as
                  | { message?: string }
                  | undefined;
                const span = field.colSpan === 2 ? 'sm:col-span-2' : '';

                if (field.kind === 'switch') {
                  return (
                    <div
                      key={id}
                      className={`flex items-start justify-between gap-4 rounded-md border p-3 ${span || 'sm:col-span-2'}`}
                    >
                      <div>
                        <Label htmlFor={id}>{field.label}</Label>
                        {field.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p>
                        )}
                      </div>
                      <Controller
                        name={field.name}
                        control={control}
                        render={({ field: controlled }) => (
                          <Switch
                            id={id}
                            checked={Boolean(controlled.value)}
                            onCheckedChange={controlled.onChange}
                          />
                        )}
                      />
                    </div>
                  );
                }

                return (
                  <FormField
                    key={id}
                    id={id}
                    label={field.label}
                    error={error?.message}
                    description={'description' in field ? field.description : undefined}
                    required={'required' in field ? field.required : undefined}
                    className={span}
                  >
                    {field.kind === 'textarea' ? (
                      <Textarea id={id} rows={field.rows ?? 3} {...register(field.name)} />
                    ) : field.kind === 'number' ? (
                      <Input
                        id={id}
                        type="number"
                        step={field.step ?? '1'}
                        min={field.min}
                        max={field.max}
                        inputMode="decimal"
                        aria-invalid={Boolean(error)}
                        {...register(field.name)}
                      />
                    ) : field.kind === 'select' ? (
                      <Controller
                        name={field.name}
                        control={control}
                        render={({ field: controlled }) => (
                          <Select
                            value={String(controlled.value ?? field.emptyOption?.value ?? '')}
                            onValueChange={controlled.onChange}
                          >
                            <SelectTrigger id={id} aria-invalid={Boolean(error)}>
                              <SelectValue placeholder={field.emptyOption?.label ?? 'Choose one'} />
                            </SelectTrigger>
                            <SelectContent>
                              {field.emptyOption && (
                                <SelectItem value={field.emptyOption.value}>
                                  {field.emptyOption.label}
                                </SelectItem>
                              )}
                              {field.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    ) : (
                      <Input
                        id={id}
                        placeholder={field.placeholder}
                        aria-invalid={Boolean(error)}
                        className={field.uppercase ? 'uppercase' : undefined}
                        {...register(field.name)}
                      />
                    )}
                  </FormField>
                );
              })}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editing ? 'Save changes' : `Create ${singular.toLowerCase()}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget ? displayName(deleteTarget) : singular.toLowerCase()}?`}
        description={`This cannot be undone. If anything still references this ${singular.toLowerCase()}, the delete will be refused and you'll be told what is in the way.`}
        confirmLabel={`Delete ${singular.toLowerCase()}`}
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
