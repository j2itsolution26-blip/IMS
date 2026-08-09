import 'server-only';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, ValidationError } from '@/lib/errors';

/**
 * Uniform server-action result. Actions never throw at the client boundary —
 * a thrown error in a server action reaches the browser as an opaque digest,
 * which is useless for showing the user what went wrong.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export const fail = (
  error: string,
  code = 'ERROR',
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> => ({ ok: false, error, code, fieldErrors });

function describePrismaError(error: Prisma.PrismaClientKnownRequestError): ActionResult<never> {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | string | undefined) ?? [];
      const fields = Array.isArray(target) ? target : [target];
      const label = fields.join(', ') || 'value';
      return fail(
        `That ${label} is already taken.`,
        'CONFLICT',
        Object.fromEntries(fields.map((f) => [f, [`This ${f} is already in use.`]])),
      );
    }
    case 'P2003':
      return fail('That change breaks a link to another record.', 'CONFLICT');
    case 'P2025':
      return fail('The record no longer exists.', 'NOT_FOUND');
    default:
      return fail('The database rejected the request.', error.code);
  }
}

/**
 * Wraps a server action body, converting domain errors, Zod errors, and Prisma
 * errors into an `ActionResult`.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof ValidationError) {
      return fail(error.message, error.code, error.fieldErrors);
    }
    if (error instanceof AppError) {
      return fail(error.message, error.code);
    }
    if (error instanceof z.ZodError) {
      return fail('Please correct the highlighted fields.', 'VALIDATION_ERROR', error.flatten().fieldErrors as Record<string, string[]>);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return describePrismaError(error);
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return fail(
        'Cannot reach the database. Check DATABASE_URL and that migrations have been applied.',
        'DB_UNAVAILABLE',
      );
    }
    // Unexpected — log the real cause server-side, return something generic.
    console.error('[action] unhandled error', error);
    return fail('Something went wrong. Please try again.', 'INTERNAL_ERROR');
  }
}

/** Validates input with Zod and raises a ValidationError carrying field errors. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      'Please correct the highlighted fields.',
      result.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }
  return result.data;
}
