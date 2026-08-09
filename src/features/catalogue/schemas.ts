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

const code = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash, or underscore only.')
    .transform((value) => value.toUpperCase());

const optionalEmail = z
  .string()
  .trim()
  .max(160)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: 'Enter a valid email address.',
  });

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

export const brandSchema = z.object({
  name: name('Brand name'),
  description: optionalText(),
  logoUrl: optionalText(500),
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

export const warehouseSchema = z.object({
  code: code('Warehouse code'),
  name: name('Warehouse name'),
  address: optionalText(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const supplierSchema = z.object({
  code: code('Supplier code'),
  name: name('Supplier name', 160),
  contactName: optionalText(120),
  email: optionalEmail,
  phone: optionalText(40),
  address: optionalText(),
  taxNumber: optionalText(60),
  leadTimeDays: z.coerce.number().int().min(0, 'Lead time cannot be negative.').max(365).default(0),
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});

export const customerSchema = z.object({
  code: code('Customer code'),
  name: name('Customer name', 160),
  email: optionalEmail,
  phone: optionalText(40),
  address: optionalText(),
  taxNumber: optionalText(60),
  creditLimit: z.coerce.number().min(0, 'Credit limit cannot be negative.').max(1_000_000_000).default(0),
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});

export type CategoryInput = z.input<typeof categorySchema>;
export type BrandInput = z.input<typeof brandSchema>;
export type UnitInput = z.input<typeof unitSchema>;
export type WarehouseInput = z.input<typeof warehouseSchema>;
export type SupplierInput = z.input<typeof supplierSchema>;
export type CustomerInput = z.input<typeof customerSchema>;
