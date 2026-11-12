import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, ValidationError } from '@/lib/errors';

/**
 * Shared plumbing for the offline POS endpoints under /api/pos.
 *
 * These are route handlers rather than server actions on purpose: a server
 * action's id changes with every deploy, so a till still running yesterday's
 * JavaScript could not upload the sales it took offline. A URL does not change.
 *
 * Every failure answers `{ ok: false, code, error, retryable }`, and the HTTP
 * status tells the till what to do with the sale (see classifySyncResult in
 * src/lib/offline-sale.ts): 401 sign in again, 403 wait, 409/422 show it to
 * the cashier, 429/5xx try again later.
 */

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function fail(status: number, code: string, error: string, retryable = status === 429 || status >= 500): NextResponse {
  return json({ ok: false, code, error, retryable }, status);
}

/**
 * Refuses a write that did not come from this site's own pages. The session
 * cookie is SameSite=Lax already; this also requires a JSON body, which a
 * cross-site form cannot send without a CORS preflight this app never grants.
 */
export function sameOriginJson(request: NextRequest): NextResponse | null {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request as JSON.');
  }
  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) return fail(403, 'CROSS_ORIGIN', 'This request did not come from the store app.');
  }
  return null;
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

/** Turns anything a handler throws into the endpoint's error answer. */
export function errorResponse(error: unknown, scope: string): NextResponse {
  if (error instanceof ValidationError) return fail(422, error.code, error.message, false);
  // A 4xx is about this request and is not retried; only 429 and 5xx are.
  if (error instanceof AppError) return fail(error.status, error.code, error.message);
  if (error instanceof z.ZodError) {
    return fail(422, 'VALIDATION_ERROR', 'The sale record is incomplete or malformed.', false);
  }
  if (error instanceof Error) {
    // Database rules (migrations 20261106090000, 20261113090000): the sale
    // itself cannot be recorded as sent.
    const branchRule = /BRANCH_RULE: ([^\n]+)/.exec(error.message);
    if (branchRule) return fail(422, 'BRANCH_RULE', branchRule[1].trim(), false);
    if (error.message.includes('UNIT_PRECISION')) {
      return fail(422, 'UNIT_PRECISION', 'A quantity in this sale is a fraction of a product sold in whole units.', false);
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return fail(503, 'DB_UNAVAILABLE', 'The store database could not be reached. The sale is safe on this device and will be sent again.');
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Transaction conflicts and timeouts pass; anything else is a defect worth retrying once fixed.
    console.error(`[${scope}] database error`, error.code, error.message);
    return fail(503, error.code, 'The server could not save this right now. It will be sent again.');
  }
  console.error(`[${scope}] unhandled error`, error);
  return fail(500, 'INTERNAL_ERROR', 'Something went wrong on the server. The sale is safe on this device and will be sent again.');
}
