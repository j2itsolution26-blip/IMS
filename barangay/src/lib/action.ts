import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { ActionError } from './session';

const FIELD_LABELS: Record<string, string> = {
  orNumber: 'official receipt number',
  username: 'username',
  householdNo: 'household number',
  name: 'name',
};

export type ActionResult = { error?: string; ok?: string } | void;

/**
 * Wraps a server action body: known failures come back as a message for the
 * form; anything unexpected is logged and reported generically.
 */
export async function runAction(body: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await body();
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof ActionError) return { error: err.message };
    if (err instanceof ZodError) return { error: err.issues[0]?.message ?? 'Please check the form.' };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const fields = (err.meta?.target as string[] | undefined) ?? [];
      const label = fields.map((f) => FIELD_LABELS[f] ?? f).join(', ') || 'value';
      return { error: `That ${label} is already in use.` };
    }
    console.error(err);
    return { error: 'Something went wrong. Please try again.' };
  }
}
