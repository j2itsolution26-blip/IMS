import { z } from 'zod';

/**
 * Validation for product categories. Shared by the form and the server action.
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

export type CategoryInput = z.input<typeof categorySchema>;
