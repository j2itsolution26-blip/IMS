'use client';

import * as React from 'react';
import { FolderTree, Scale } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { ResourceManager, type FieldSpec } from '@/features/catalogue/resource-manager';
import {
  categorySchema,
  unitSchema,
  type CategoryInput,
  type UnitInput,
} from '@/features/catalogue/schemas';
import {
  createCategory,
  createUnit,
  deleteCategory,
  deleteUnit,
  updateCategory,
  updateUnit,
} from '@/features/catalogue/actions';
import { formatNumber } from '@/lib/format';

/**
 * Category and Unit management. These are the only two reference lists a
 * sari-sari store needs, and they live inside the Inventory page rather than
 * as their own top-level nav items.
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

// --- Units ------------------------------------------------------------------

export interface UnitRow {
  id: string;
  name: string;
  abbreviation: string;
  factor: number;
  allowDecimal: boolean;
  productCount: number;
  isActive: boolean;
}

export function UnitsManager({ rows, permissions }: { rows: UnitRow[]; permissions: Permissions }) {
  const columns = React.useMemo<ColumnDef<UnitRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Unit',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.abbreviation}</p>
          </div>
        ),
      },
      {
        accessorKey: 'factor',
        header: 'Factor',
        cell: ({ row }) => <span className="tabular text-sm">{formatNumber(row.original.factor, 4)}</span>,
      },
      {
        accessorKey: 'allowDecimal',
        header: 'Fractional',
        cell: ({ row }) => (
          <Badge variant={row.original.allowDecimal ? 'default' : 'secondary'}>
            {row.original.allowDecimal ? 'Allowed' : 'Whole only'}
          </Badge>
        ),
      },
      {
        accessorKey: 'productCount',
        header: 'Products',
        cell: ({ row }) => countCell(row.original.productCount, 'product'),
      },
      activeBadge<UnitRow>(),
    ],
    [],
  );

  const fields: FieldSpec<UnitInput>[] = [
    { kind: 'text', name: 'name', label: 'Name', placeholder: 'Piece, Bottle, Sachet…', required: true },
    { kind: 'text', name: 'abbreviation', label: 'Abbreviation', placeholder: 'pc, btl, sct', required: true },
    {
      kind: 'number',
      name: 'factor',
      label: 'Factor',
      step: '0.0001',
      min: 0.0001,
      description: 'How many base units this represents. 1 for a base unit, 24 for a case of 24.',
      colSpan: 2,
    },
    {
      kind: 'switch',
      name: 'allowDecimal',
      label: 'Allow fractional quantities',
      description: 'Turn on for weight or volume, e.g. 0.25 kg.',
    },
    { kind: 'switch', name: 'isActive', label: 'Active' },
  ];

  return (
    <ResourceManager<UnitRow, UnitInput>
      rows={rows}
      columns={columns}
      searchKeys={['name', 'abbreviation']}
      schema={unitSchema}
      fields={fields}
      emptyValues={{ name: '', abbreviation: '', factor: 1, allowDecimal: false, isActive: true }}
      toFormValues={(row) => ({
        name: row.name,
        abbreviation: row.abbreviation,
        factor: row.factor,
        allowDecimal: row.allowDecimal,
        isActive: row.isActive,
      })}
      singular="Unit"
      plural="Units"
      displayName={(row) => row.name}
      emptyIcon={Scale}
      emptyDescription="Units define how each product is counted — pieces, bottles, sachets. Every product needs one."
      {...permissions}
      onCreate={createUnit}
      onUpdate={updateUnit}
      onDelete={deleteUnit}
    />
  );
}
