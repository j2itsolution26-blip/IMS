import { z } from 'zod';
import { validateImageUrl } from '@/lib/image-url';

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
    // Validated on the server as well as in the browser: a client-only check
    // would be bypassed by posting the form directly, and a page URL saved here
    // renders as a broken image everywhere the product appears.
    imageUrl: z
      .string()
      .trim()
      .superRefine((value, ctx) => {
        const result = validateImageUrl(value);
        if (!result.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason });
        }
      })
      .transform((value) => (value === '' ? null : value))
      .nullable(),

    categoryId: z.string().trim().min(1, 'Choose a category.'),
    unitId: z.string().trim().min(1, 'Choose a unit of measure.'),

    costPrice: decimalField('Cost price'),
    sellingPrice: decimalField('Selling price'),

    minStock: decimalField('Minimum stock'),
    maxStock: decimalField('Maximum stock'),
    reorderLevel: decimalField('Low-stock level'),
    reorderQty: decimalField('Reorder quantity'),

    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).default('ACTIVE'),
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
  { value: 'ARCHIVED', label: 'Archived', description: 'Hidden everywhere; stock and history are retained.' },
] as const;
