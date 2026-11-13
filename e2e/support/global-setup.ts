/**
 * Refuses to run the browser tests anywhere but a local app on a local,
 * throwaway database: they create stores, sell, and change stock.
 */
export default async function globalSetup(): Promise<void> {
  const base = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3107');
  if (!['localhost', '127.0.0.1'].includes(base.hostname)) {
    throw new Error(`E2E_BASE_URL must be a local app (localhost), not ${base.host}.`);
  }
  const database = process.env.E2E_DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(database)) {
    throw new Error('Set E2E_DATABASE_URL to the local throwaway database the app under test was started with. Never the production database.');
  }
  try {
    await fetch(new URL('/sign-in', base), { redirect: 'manual' });
  } catch {
    throw new Error(`Nothing answers at ${base.origin}. Start the app first (see docs/offline-pos.md, "Browser tests").`);
  }
}
