'use server';

import { z } from 'zod';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { getRequestContext } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { normalizeUsername, usernameProblem } from '@/lib/username';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password';
import { completeSetup } from '@/server/platform/setup-service';

/**
 * First-time setup's only action. Anonymous by necessity (no account exists
 * yet), so it accepts no role, store or "setup required" flag from the
 * browser: the service decides all of that from the database. Everything typed
 * is validated here and again by Better Auth's own checks.
 */

const setupSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name.').max(80, 'Use at most 80 characters.'),
    username: z
      .string()
      .transform(normalizeUsername)
      .superRefine((value, ctx) => {
        const problem = usernameProblem(value);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
    password: z
      .string()
      .max(128, 'Use at most 128 characters.')
      .refine((value) => validatePassword(value).isValid, PASSWORD_POLICY_MESSAGE),
    confirmPassword: z.string(),
    setupKey: z.string().max(512).optional(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  });

export async function completeSetupAction(input: unknown): Promise<ActionResult<{ username: string }>> {
  return runAction(async () => {
    const { ipAddress } = await getRequestContext().catch(() => ({ ipAddress: null }));
    // Slows down guessing a setup key; a RateLimitError becomes a normal failure.
    checkRateLimit(`setup:${ipAddress ?? 'unknown'}`, RATE_LIMITS.auth);
    const values = parseInput(setupSchema, input);
    const { username } = await completeSetup({
      name: values.name,
      username: values.username,
      email: values.email,
      password: values.password,
      setupKey: values.setupKey,
    });
    return { username };
  });
}
