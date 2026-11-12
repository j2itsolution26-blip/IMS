import { z } from 'zod';
import { checkbox, optionalText, text } from './form';
import { parseCalendarDate } from './dates';

export const residentSchema = z.object({
  lastName: text('Last name', 80),
  firstName: text('First name', 80),
  middleName: optionalText(80),
  suffix: optionalText(10),
  sex: z.enum(['MALE', 'FEMALE'], { errorMap: () => ({ message: 'Choose the sex.' }) }),
  birthDate: z
    .string()
    .transform((v, ctx) => {
      const d = parseCalendarDate(v);
      if (!d || d > new Date() || d.getUTCFullYear() < 1900) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid birth date.' });
        return z.NEVER;
      }
      return d;
    }),
  birthPlace: optionalText(120),
  civilStatus: z.enum(['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED', 'LIVE_IN'], {
    errorMap: () => ({ message: 'Choose the civil status.' }),
  }),
  citizenship: optionalText(60).transform((v) => v || 'Filipino'),
  occupation: optionalText(100),
  contactNumber: optionalText(30),
  address: text('Address', 200),
  purokId: text('Purok', 40),
  householdId: optionalText(40).transform((v) => v || null),
  relationshipToHead: optionalText(40),
  residentSince: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1900 || n > new Date().getFullYear()) {
        ctx.addIssue({ code: 'custom', message: 'Resident since must be a year, like 2015.' });
        return z.NEVER;
      }
      return n;
    }),
  isVoter: checkbox,
  isPwd: checkbox,
  is4Ps: checkbox,
  isSoloParent: checkbox,
  isIndigent: checkbox,
  status: z.enum(['ACTIVE', 'MOVED_OUT', 'DECEASED']).optional().default('ACTIVE'),
});

export type ResidentInput = z.infer<typeof residentSchema>;
