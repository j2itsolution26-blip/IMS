import { z } from 'zod';

/**
 * Validation for the reference entities. Shared by their forms and their
 * server actions.
 */

const name = (label: string, max = 120) =>
  z.string().trim().min(2, `${label} must be at least 2 characters.`).max(max);

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

export const categorySchema = z.object({
  name: name('Category name'),
  description: optionalText(),
  parentId: z
    .string()
    .trim()
    .transform((value) => (value === '' || value === 'none' ? null : value))
    .nullable(),
  isActive: z.boolean().default(true),
});

export const unitSchema = z.object({
  name: name('Unit name', 60),
  abbreviation: z.string().trim().min(1, 'Abbreviation is required.').max(12),
  // A "Case of 24" has factor 24 relative to the base unit.
  factor: z.coerce.number().positive('Factor must be greater than zero.').max(1_000_000).default(1),
  allowDecimal: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type CategoryInput = z.input<typeof categorySchema>;
export type UnitInput = z.input<typeof unitSchema>;
