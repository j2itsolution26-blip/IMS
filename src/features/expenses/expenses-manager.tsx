'use client';

import * as React from 'react';
import { Receipt } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { ResourceManager, type FieldSpec } from '@/features/catalogue/resource-manager';
import type { Permissions } from '@/features/catalogue/managers';
import { createExpense, deleteExpense, updateExpense } from '@/features/expenses/actions';
import { EXPENSE_CATEGORIES, expenseSchema, type ExpenseInput } from '@/features/expenses/schema';
import { formatCurrency, formatDate, humanizeEnum } from '@/lib/format';

export interface ExpenseRow {
  id: string;
  reference: string;
  category: string;
  description: string | null;
  amount: number;
  method: string;
  incurredAt: string;
  recordedBy: string;
}

/** Expense screen. Reuses the shared resource manager — same shape, different fields. */
export function ExpensesManager({
  rows,
  permissions,
  currency,
}: {
  rows: ExpenseRow[];
  permissions: Permissions;
  currency: string;
}) {
  const columns = React.useMemo<ColumnDef<ExpenseRow, unknown>[]>(
    () => [
      {
        accessorKey: 'incurredAt',
        header: 'Date',
        cell: ({ row }) => (
          <div>
            <p className="whitespace-nowrap text-sm font-medium">{formatDate(row.original.incurredAt)}</p>
            <p className="text-xs text-muted-foreground">{row.original.reference}</p>
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium">{row.original.category}</p>
            {row.original.description && (
              <p className="line-clamp-1 text-xs text-muted-foreground">{row.original.description}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'method',
        header: 'Paid by',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{humanizeEnum(row.original.method)}</span>
        ),
      },
      {
        accessorKey: 'recordedBy',
        header: 'Recorded by',
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.recordedBy}</span>,
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => (
          <span className="tabular font-medium">{formatCurrency(row.original.amount, currency)}</span>
        ),
      },
    ],
    [currency],
  );

  const fields: FieldSpec<ExpenseInput>[] = [
    {
      kind: 'select',
      name: 'category',
      label: 'Category',
      required: true,
      options: EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category })),
    },
    {
      kind: 'select',
      name: 'method',
      label: 'Paid by',
      options: [
        { value: 'CASH', label: 'Cash' },
        { value: 'BANK_TRANSFER', label: 'Bank transfer' },
        { value: 'GCASH', label: 'GCash' },
        { value: 'MAYA', label: 'Maya' },
        { value: 'CARD', label: 'Card' },
        { value: 'CREDIT', label: 'On account' },
      ],
    },
    { kind: 'number', name: 'amount', label: 'Amount', step: '0.01', min: 0, required: true },
    { kind: 'text', name: 'incurredAt', label: 'Date incurred', required: true, placeholder: 'YYYY-MM-DD' },
    { kind: 'textarea', name: 'description', label: 'Description', rows: 2, colSpan: 2 },
  ];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ResourceManager<ExpenseRow, ExpenseInput>
      rows={rows}
      columns={columns}
      searchKeys={['category', 'description', 'reference']}
      searchPlaceholder="Search category, description, or reference…"
      schema={expenseSchema}
      fields={fields}
      emptyValues={{
        category: 'Other',
        description: '',
        amount: 0,
        method: 'CASH',
        incurredAt: today,
      }}
      toFormValues={(row) => ({
        category: row.category,
        description: row.description ?? '',
        amount: row.amount,
        method: row.method as ExpenseInput['method'],
        incurredAt: row.incurredAt.slice(0, 10),
      })}
      singular="Expense"
      plural="Expenses"
      displayName={(row) => `${row.category} — ${row.reference}`}
      emptyIcon={Receipt}
      emptyDescription="Recording operating costs here is what turns gross profit into a real net profit figure on the dashboard."
      {...permissions}
      onCreate={createExpense}
      onUpdate={updateExpense}
      onDelete={deleteExpense}
    />
  );
}
