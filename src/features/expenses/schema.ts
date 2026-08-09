import { z } from 'zod';

/**
 * Expense validation.
 *
 * Kept out of `actions.ts` because a `'use server'` module may only export
 * async functions — a schema or constant exported from one is a build error.
 */

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries',
  'Transport',
  'Supplies',
  'Marketing',
  'Repairs',
  'Taxes & licences',
  'Bank charges',
  'Other',
] as const;

export const expenseSchema = z.object({
  category: z.string().trim().min(1, 'Choose a category.').max(60),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value))
    .nullable(),
  amount: z.coerce.number().positive('Enter an amount greater than zero.').max(1_000_000_000),
  method: z.enum(['CASH', 'GCASH', 'MAYA', 'CARD', 'BANK_TRANSFER', 'CREDIT']).default('CASH'),
  incurredAt: z
    .string()
    .min(1, 'Choose a date.')
    .transform((value) => new Date(value))
    .refine((value) => !Number.isNaN(value.getTime()), 'Enter a valid date.'),
});

export type ExpenseInput = z.input<typeof expenseSchema>;
