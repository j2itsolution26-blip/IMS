import { z } from 'zod';

/**
 * Product validation. Shared by the client form and the server action so the
 * two can never disagree about what a valid product is.
 */

/** Accepts "" from an unfilled numeric input and treats it as 0. */
const decimalField = (label: string, { min = 0, max = 1_000_000_000 } = {}) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number.` })
    .min(min, `${label} cannot be less than ${min}.`)
    .max(max, `${label} is unreasonably large.`)
    .finite();

const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === '' || value === 'none' ? null : value))
  .nullable();

export const productSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the product a name.').max(160),
    sku: z
      .string()
      .trim()
      .min(1, 'SKU is required.')
      .max(64)
      .regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, numbers, dot, dash, slash, or underscore only.'),
    barcode: z
      .string()
      .trim()
      .max(64)
      .transform((value) => (value === '' ? null : value))
      .nullable(),
    description: z
      .string()
      .trim()
      .max(2000)
      .transform((value) => (value === '' ? null : value))
      .nullable(),
    imageUrl: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : value))
      .nullable(),

    categoryId: z.string().trim().min(1, 'Choose a category.'),
    unitId: z.string().trim().min(1, 'Choose a unit of measure.'),
    brandId: optionalId,
    supplierId: optionalId,

    costPrice: decimalField('Cost price'),
    sellingPrice: decimalField('Selling price'),
    taxRate: decimalField('Tax rate', { max: 100 }),

    minStock: decimalField('Minimum stock'),
    maxStock: decimalField('Maximum stock'),
    reorderLevel: decimalField('Reorder level'),
    reorderQty: decimalField('Reorder quantity'),

    status: z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']).default('ACTIVE'),
    isTrackable: z.boolean().default(true),
  })
  .superRefine((values, ctx) => {
    // A max below the min would make the overstock and reorder maths nonsense.
    if (values.maxStock > 0 && values.maxStock < values.minStock) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxStock'],
        message: 'Maximum stock must be at least the minimum stock.',
      });
    }
    if (values.maxStock > 0 && values.reorderLevel > values.maxStock) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reorderLevel'],
        message: 'Reorder level cannot exceed maximum stock.',
      });
    }
    // Selling below cost is legitimate (clearance), so it warns rather than
    // blocking — but selling at zero with a non-zero cost is almost always a typo.
    if (values.sellingPrice === 0 && values.costPrice > 0 && values.status === 'ACTIVE') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sellingPrice'],
        message: 'An active product with a cost needs a selling price.',
      });
    }
  });

export type ProductInput = z.input<typeof productSchema>;
export type ProductValues = z.output<typeof productSchema>;

export const PRODUCT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active', description: 'Sellable and counted in stock reports.' },
  { value: 'INACTIVE', label: 'Inactive', description: 'Hidden from the POS but stock is retained.' },
  { value: 'DISCONTINUED', label: 'Discontinued', description: 'No longer stocked or reordered.' },
] as const;
