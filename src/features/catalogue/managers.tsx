'use client';

import * as React from 'react';
import { FolderTree } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { ResourceManager, type FieldSpec } from '@/features/catalogue/resource-manager';
import { categorySchema, type CategoryInput } from '@/features/catalogue/schemas';
import { createCategory, deleteCategory, updateCategory } from '@/features/catalogue/actions';
import { formatNumber } from '@/lib/format';

/**
 * Category management. Categories are the only reference list the store
 * needs (every product is sold by the piece, so there are no units), and it
 * lives inside the Inventory page rather than as its own nav item.
 */

export interface Permissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

const activeBadge = <T extends { isActive: boolean }>(): ColumnDef<T, unknown> => ({
  accessorKey: 'isActive',
  header: 'Status',
  cell: ({ row }) => (
    <Badge variant={row.original.isActive ? 'success' : 'secondary'}>
      {row.original.isActive ? 'Active' : 'Inactive'}
    </Badge>
  ),
});

/** "3 products" / "none" — used in the usage columns of several tables. */
function countCell(value: number, label: string) {
  if (value === 0) return <span className="text-xs text-muted-foreground">none</span>;
  return (
    <span className="tabular">
      {formatNumber(value, 0)} {value === 1 ? label : `${label}s`}
    </span>
  );
}

// --- Categories -------------------------------------------------------------

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  productCount: number;
  isActive: boolean;
}

export function CategoriesManager({
  rows,
  permissions,
}: {
  rows: CategoryRow[];
  permissions: Permissions;
}) {
  const columns = React.useMemo<ColumnDef<CategoryRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Category',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            {row.original.parentName && (
              <p className="truncate text-xs text-muted-foreground">under {row.original.parentName}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: ({ row }) => (
          <span className="line-clamp-1 text-sm text-muted-foreground">
            {row.original.description ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'productCount',
        header: 'Products',
        cell: ({ row }) => countCell(row.original.productCount, 'product'),
      },
      activeBadge<CategoryRow>(),
    ],
    [],
  );

  // A category cannot be its own parent, and the list excludes itself when editing.
  const parentOptions = rows.map((row) => ({ value: row.id, label: row.name }));

  const fields: FieldSpec<CategoryInput>[] = [
    { kind: 'text', name: 'name', label: 'Name', required: true, colSpan: 2 },
    {
      kind: 'select',
      name: 'parentId',
      label: 'Parent category',
      description: 'Optional — use to nest categories, e.g. Beverages → Soft drinks.',
      options: parentOptions,
      emptyOption: { value: 'none', label: 'Top level' },
      colSpan: 2,
    },
    { kind: 'textarea', name: 'description', label: 'Description', colSpan: 2 },
    { kind: 'switch', name: 'isActive', label: 'Active', description: 'Inactive categories are hidden when creating products.' },
  ];

  return (
    <ResourceManager<CategoryRow, CategoryInput>
      rows={rows}
      columns={columns}
      searchKeys={['name', 'description']}
      schema={categorySchema}
      fields={fields}
      emptyValues={{ name: '', description: '', parentId: 'none', isActive: true }}
      toFormValues={(row) => ({
        name: row.name,
        description: row.description ?? '',
        parentId: row.parentId ?? 'none',
        isActive: row.isActive,
      })}
      singular="Category"
      plural="Categories"
      displayName={(row) => row.name}
      emptyIcon={FolderTree}
      emptyDescription="Categories group your products so reports and the POS stay organised. Every product needs one."
      {...permissions}
      onCreate={createCategory}
      onUpdate={updateCategory}
      onDelete={deleteCategory}
    />
  );
}
