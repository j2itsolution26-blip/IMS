/**
 * Where first-time setup stands, as the setup and sign-in pages need it.
 *
 *   required          no completed setup and no account: show the setup form
 *   closed            already set up: go to sign-in
 *   needs-migrations  the database answers but its tables are missing or
 *                     out of date (a new database before `prisma migrate deploy`)
 *   unreachable       the database cannot be reached at all
 *   failed            anything else (logged on the server)
 *
 * Pure, so the error classification is unit-tested without a database.
 */

export type SetupStatus = 'required' | 'closed' | 'needs-migrations' | 'unreachable' | 'failed';

/** Prisma errors that mean "connected, but the schema is not what this code expects". */
const SCHEMA_CODES = new Set(['P2021', 'P2022', 'P3005', 'P3009', 'P3018']);
/** Prisma errors that mean "could not talk to the database". */
const CONNECTION_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1011', 'P1017']);
/** PostgreSQL: undefined table / undefined column / undefined object. */
const PG_SCHEMA_CODES = new Set(['42P01', '42703', '42704']);

/** The error code only (never the message, which can carry connection details). */
export function errorCode(error: unknown): string {
  const value = error as { code?: unknown; errorCode?: unknown; meta?: { code?: unknown } } | null;
  const code = value?.code ?? value?.errorCode ?? value?.meta?.code;
  return typeof code === 'string' ? code : (error as Error | null)?.name ?? 'unknown';
}

export function classifySetupError(error: unknown): Exclude<SetupStatus, 'required' | 'closed'> {
  const value = error as { name?: unknown; message?: unknown; meta?: { code?: unknown } } | null;
  const code = errorCode(error);
  const message = typeof value?.message === 'string' ? value.message : '';
  if (SCHEMA_CODES.has(code) || PG_SCHEMA_CODES.has(code) || PG_SCHEMA_CODES.has(String(value?.meta?.code ?? ''))) {
    return 'needs-migrations';
  }
  if (/relation "[^"]+" does not exist|column "[^"]+" does not exist/.test(message)) return 'needs-migrations';
  if (CONNECTION_CODES.has(code) || value?.name === 'PrismaClientInitializationError' || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/.test(code + message)) {
    return 'unreachable';
  }
  return 'failed';
}
