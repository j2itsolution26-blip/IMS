import { z } from 'zod';

/** FormData → plain object of trimmed strings; checkboxes become "on". */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v.trim();
  return out;
}

export const text = (label: string, max = 200) =>
  z.string({ required_error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

export const optionalText = (max = 200) => z.string().trim().max(max).optional().default('');

export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === 'on');

export const money = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, `${label} must be an amount like 50 or 50.00.`);
