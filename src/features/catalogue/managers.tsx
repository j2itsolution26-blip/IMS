'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, FolderTree, Scale, Truck, Users, Warehouse } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { ResourceManager, type FieldSpec } from '@/features/catalogue/resource-manager';
import {
  brandSchema,
  categorySchema,
  customerSchema,
  supplierSchema,
  unitSchema,
  warehouseSchema,
  type BrandInput,
  type CategoryInput,
  type CustomerInput,
  type SupplierInput,
  type UnitInput,
  type WarehouseInput,
} from '@/features/catalogue/schemas';
import {
  createBrand,
  createCategory,
  createCustomer,
  createSupplier,
  createUnit,
  createWarehouse,
  deleteBrand,
  deleteCategory,
  deleteCustomer,
  deleteSupplier,
  deleteUnit,
  deleteWarehouse,
  updateBrand,
  updateCategory,
  updateCustomer,
  updateSupplier,
  updateUnit,
  updateWarehouse,
} from '@/features/catalogue/actions';
import { formatCurrency, formatNumber } from '@/lib/format';

/**
 * Per-entity configuration for the shared `ResourceManager`.
 *
 * Column renderers are functions, so they cannot cross the server/client
 * boundary as props — each entity's table shape is therefore declared here in
 * a client module rather than in its page.
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

// --- Brands -----------------------------------------------------------------

export interface BrandRow {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  productCount: number;
  isActive: boolean;
}

export function BrandsManager({ rows, permissions }: { rows: BrandRow[]; permissions: Permissions }) {
  const columns = React.useMemo<ColumnDef<BrandRow, unknown>[]>(
    () => [
      { accessorKey: 'name', header: 'Brand', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: ({ row }) => (
          <span className="line-clamp-1 text-sm text-muted-foreground">{row.original.description ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'productCount',
        header: 'Products',
        cell: ({ row }) => countCell(row.original.productCount, 'product'),
      },
      activeBadge<BrandRow>(),
    ],
    [],
  );

  const fields: FieldSpec<BrandInput>[] = [
    { kind: 'text', name: 'name', label: 'Name', required: true, colSpan: 2 },
    { kind: 'text', name: 'logoUrl', label: 'Logo URL', placeholder: 'https://…', colSpan: 2 },
    { kind: 'textarea', name: 'description', label: 'Description', colSpan: 2 },
    { kind: 'switch', name: 'isActive', label: 'Active' },
  ];

  return (
    <ResourceManager<BrandRow, BrandInput>
      rows={rows}
      columns={columns}
      searchKeys={['name', 'description']}
      schema={brandSchema}
      fields={fields}
      emptyValues={{ name: '', description: '', logoUrl: '', isActive: true }}
      toFormValues={(row) => ({
        name: row.name,
        description: row.description ?? '',
        logoUrl: row.logoUrl ?? '',
        isActive: row.isActive,
      })}
      singular="Brand"
      plural="Brands"
      displayName={(row) => row.name}
      emptyIcon={Building2}
      emptyDescription="Brands are optional, but they let you break sales down by manufacturer in reports."
      {...permissions}
      onCreate={createBrand}
      onUpdate={updateBrand}
      onDelete={deleteBrand}
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
    { kind: 'text', name: 'name', label: 'Name', placeholder: 'Piece, Kilogram, Case of 24…', required: true },
    { kind: 'text', name: 'abbreviation', label: 'Abbreviation', placeholder: 'pc, kg, case', required: true },
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
      emptyDescription="Units define how each product is counted — pieces, kilograms, litres, cases. Every product needs one."
      {...permissions}
      onCreate={createUnit}
      onUpdate={updateUnit}
      onDelete={deleteUnit}
    />
  );
}

// --- Warehouses -------------------------------------------------------------

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  stockValue: number;
  productCount: number;
}

export function WarehousesManager({
  rows,
  permissions,
  currency,
}: {
  rows: WarehouseRow[];
  permissions: Permissions;
  currency: string;
}) {
  const columns = React.useMemo<ColumnDef<WarehouseRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Warehouse',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              {row.original.name}
              {row.original.isDefault && <Badge variant="default">Default</Badge>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{row.original.code}</p>
          </div>
        ),
      },
      {
        accessorKey: 'address',
        header: 'Address',
        cell: ({ row }) => (
          <span className="line-clamp-1 text-sm text-muted-foreground">{row.original.address ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'productCount',
        header: 'Stocked lines',
        cell: ({ row }) => countCell(row.original.productCount, 'line'),
      },
      {
        accessorKey: 'stockValue',
        header: 'Stock value',
        cell: ({ row }) => (
          <span className="tabular font-medium">{formatCurrency(row.original.stockValue, currency)}</span>
        ),
      },
      activeBadge<WarehouseRow>(),
    ],
    [currency],
  );

  const fields: FieldSpec<WarehouseInput>[] = [
    { kind: 'text', name: 'code', label: 'Code', placeholder: 'MAIN', required: true, uppercase: true },
    { kind: 'text', name: 'name', label: 'Name', placeholder: 'Main warehouse', required: true },
    { kind: 'textarea', name: 'address', label: 'Address', rows: 2, colSpan: 2 },
    {
      kind: 'switch',
      name: 'isDefault',
      label: 'Default warehouse',
      description: 'Pre-selected at the POS and when receiving stock. Only one can be the default.',
    },
    { kind: 'switch', name: 'isActive', label: 'Active' },
  ];

  return (
    <ResourceManager<WarehouseRow, WarehouseInput>
      rows={rows}
      columns={columns}
      searchKeys={['name', 'code', 'address']}
      schema={warehouseSchema}
      fields={fields}
      emptyValues={{ code: '', name: '', address: '', isDefault: false, isActive: true }}
      toFormValues={(row) => ({
        code: row.code,
        name: row.name,
        address: row.address ?? '',
        isDefault: row.isDefault,
        isActive: row.isActive,
      })}
      singular="Warehouse"
      plural="Warehouses"
      displayName={(row) => row.name}
      emptyIcon={Warehouse}
      emptyDescription="You need at least one warehouse before you can hold stock or sell anything. Most businesses start with a single 'Main' location."
      {...permissions}
      onCreate={createWarehouse}
      onUpdate={updateWarehouse}
      onDelete={deleteWarehouse}
    />
  );
}

// --- Suppliers --------------------------------------------------------------

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  leadTimeDays: number;
  notes: string | null;
  isActive: boolean;
  orderCount: number;
  totalSpend: number;
  outstanding: number;
}

export function SuppliersManager({
  rows,
  permissions,
  currency,
}: {
  rows: SupplierRow[];
  permissions: Permissions;
  currency: string;
}) {
  const columns = React.useMemo<ColumnDef<SupplierRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Supplier',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.original.code}
              {row.original.contactName ? ` · ${row.original.contactName}` : ''}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'phone',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground">
            <p className="truncate">{row.original.phone ?? '—'}</p>
            {row.original.email && <p className="truncate text-xs">{row.original.email}</p>}
          </div>
        ),
      },
      {
        accessorKey: 'leadTimeDays',
        header: 'Lead time',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.leadTimeDays > 0 ? `${row.original.leadTimeDays} days` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'orderCount',
        header: 'Orders',
        cell: ({ row }) => countCell(row.original.orderCount, 'order'),
      },
      {
        accessorKey: 'totalSpend',
        header: 'Total spend',
        cell: ({ row }) => (
          <div className="text-right">
            <p className="tabular font-medium">{formatCurrency(row.original.totalSpend, currency)}</p>
            {row.original.outstanding > 0 && (
              <p className="tabular text-xs text-warning">
                {formatCurrency(row.original.outstanding, currency)} owed
              </p>
            )}
          </div>
        ),
      },
      activeBadge<SupplierRow>(),
    ],
    [currency],
  );

  const fields: FieldSpec<SupplierInput>[] = [
    { kind: 'text', name: 'code', label: 'Code', placeholder: 'SUP-001', required: true, uppercase: true },
    { kind: 'text', name: 'name', label: 'Name', required: true },
    { kind: 'text', name: 'contactName', label: 'Contact person' },
    { kind: 'text', name: 'phone', label: 'Phone' },
    { kind: 'text', name: 'email', label: 'Email' },
    { kind: 'text', name: 'taxNumber', label: 'Tax / VAT number' },
    {
      kind: 'number',
      name: 'leadTimeDays',
      label: 'Lead time (days)',
      min: 0,
      max: 365,
      description: 'Used to flag late deliveries.',
    },
    { kind: 'textarea', name: 'address', label: 'Address', rows: 2, colSpan: 2 },
    { kind: 'textarea', name: 'notes', label: 'Notes', rows: 2, colSpan: 2 },
    { kind: 'switch', name: 'isActive', label: 'Active' },
  ];

  return (
    <ResourceManager<SupplierRow, SupplierInput>
      rows={rows}
      columns={columns}
      searchKeys={['name', 'code', 'contactName', 'email', 'phone']}
      schema={supplierSchema}
      fields={fields}
      emptyValues={{
        code: '',
        name: '',
        contactName: '',
        email: '',
        phone: '',
        address: '',
        taxNumber: '',
        leadTimeDays: 0,
        notes: '',
        isActive: true,
      }}
      toFormValues={(row) => ({
        code: row.code,
        name: row.name,
        contactName: row.contactName ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        address: row.address ?? '',
        taxNumber: row.taxNumber ?? '',
        leadTimeDays: row.leadTimeDays,
        notes: row.notes ?? '',
        isActive: row.isActive,
      })}
      singular="Supplier"
      plural="Suppliers"
      displayName={(row) => row.name}
      emptyIcon={Truck}
      emptyDescription="Suppliers are who you buy from. Adding them lets you raise purchase orders and track delivery reliability."
      {...permissions}
      onCreate={createSupplier}
      onUpdate={updateSupplier}
      onDelete={deleteSupplier}
    />
  );
}

// --- Customers --------------------------------------------------------------

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  creditLimit: number;
  notes: string | null;
  isActive: boolean;
  orderCount: number;
  totalSpent: number;
  lastPurchase: Date | null;
}

export function CustomersManager({
  rows,
  permissions,
  currency,
}: {
  rows: CustomerRow[];
  permissions: Permissions;
  currency: string;
}) {
  const columns = React.useMemo<ColumnDef<CustomerRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Customer',
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link href={`/customers/${row.original.id}`} className="truncate font-medium hover:underline">
              {row.original.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{row.original.code}</p>
          </div>
        ),
      },
      {
        accessorKey: 'phone',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground">
            <p className="truncate">{row.original.phone ?? '—'}</p>
            {row.original.email && <p className="truncate text-xs">{row.original.email}</p>}
          </div>
        ),
      },
      {
        accessorKey: 'orderCount',
        header: 'Purchases',
        cell: ({ row }) => countCell(row.original.orderCount, 'sale'),
      },
      {
        accessorKey: 'totalSpent',
        header: 'Total spent',
        cell: ({ row }) => (
          <span className="tabular font-medium">{formatCurrency(row.original.totalSpent, currency)}</span>
        ),
      },
      activeBadge<CustomerRow>(),
    ],
    [currency],
  );

  const fields: FieldSpec<CustomerInput>[] = [
    { kind: 'text', name: 'code', label: 'Code', placeholder: 'CUST-00001', required: true, uppercase: true },
    { kind: 'text', name: 'name', label: 'Name', required: true },
    { kind: 'text', name: 'phone', label: 'Phone' },
    { kind: 'text', name: 'email', label: 'Email' },
    { kind: 'text', name: 'taxNumber', label: 'Tax / VAT number' },
    {
      kind: 'number',
      name: 'creditLimit',
      label: 'Credit limit',
      step: '0.01',
      min: 0,
      description: 'Reference figure for credit sales.',
    },
    { kind: 'textarea', name: 'address', label: 'Address', rows: 2, colSpan: 2 },
    { kind: 'textarea', name: 'notes', label: 'Notes', rows: 2, colSpan: 2 },
    { kind: 'switch', name: 'isActive', label: 'Active' },
  ];

  return (
    <ResourceManager<CustomerRow, CustomerInput>
      rows={rows}
      columns={columns}
      searchKeys={['name', 'code', 'email', 'phone']}
      schema={customerSchema}
      fields={fields}
      emptyValues={{
        code: '',
        name: '',
        email: '',
        phone: '',
        address: '',
        taxNumber: '',
        creditLimit: 0,
        notes: '',
        isActive: true,
      }}
      toFormValues={(row) => ({
        code: row.code,
        name: row.name,
        email: row.email ?? '',
        phone: row.phone ?? '',
        address: row.address ?? '',
        taxNumber: row.taxNumber ?? '',
        creditLimit: row.creditLimit,
        notes: row.notes ?? '',
        isActive: row.isActive,
      })}
      singular="Customer"
      plural="Customers"
      displayName={(row) => row.name}
      emptyIcon={Users}
      emptyDescription="Customers are optional for walk-in sales, but recording them enables credit sales, purchase history, and best-customer reports."
      {...permissions}
      onCreate={createCustomer}
      onUpdate={updateCustomer}
      onDelete={deleteCustomer}
    />
  );
}
