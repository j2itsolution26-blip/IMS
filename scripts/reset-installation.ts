/**
 * Resets an installation to a fresh, empty system: deletes EVERY row of every
 * table — accounts, stores, products, sales, shifts, payments, settings,
 * audit history — so the next visit opens first-time setup. The tables and
 * migrations stay; only data is removed.
 *
 * Irreversible except by restoring a backup, so it refuses to run unless:
 *   1. --backup=<file> is a TindahanProMax JSON backup of THIS database whose
 *      row counts still match it exactly (so nothing has changed since);
 *   2. RESET_CONFIRM is exactly  DELETE ALL DATA IN <database> ON <host>
 *      (both printed when it refuses);
 *   3. it is run from a terminal, never inside a deployment (VERCEL unset).
 * It runs in one transaction: everything is emptied, or nothing is.
 *
 * Never triggered by the application or any URL.
 *
 *   RESET_CONFIRM="DELETE ALL DATA IN postgres ON db.example.com" \
 *     npm run db:reset-installation -- --backup=/path/to/backup.json
 */
import { readFileSync, statSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function arg(name: string): string | undefined {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match?.slice(name.length + 3).trim() || undefined;
}

function fail(message: string): never {
  console.error(`\nRefusing: ${message}\n`);
  process.exit(1);
}

interface Backup {
  meta: { format: string; database: string; createdAt: string; counts: Record<string, number> };
}

async function main() {
  if (process.env.VERCEL) fail('this command never runs inside a deployment.');

  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is not set.');
  const host = new URL(url).hostname;

  const backupPath = arg('backup');
  if (!backupPath) fail('pass --backup=<file>: a backup of this database taken just before the reset.');
  let backup: Backup;
  try {
    if (statSync(backupPath).size === 0) fail('the backup file is empty.');
    backup = JSON.parse(readFileSync(backupPath, 'utf8')) as Backup;
  } catch (error) {
    fail(`cannot read the backup file (${error instanceof Error ? error.message : 'unknown error'}).`);
  }
  if (backup.meta?.format !== 'tindahanpromax-json-backup-v1') fail('that file is not a TindahanProMax backup.');

  const prisma = new PrismaClient();
  try {
    const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>('SELECT current_database() AS db');
    if (backup.meta.database !== db) fail(`the backup is of database "${backup.meta.database}", not "${db}".`);

    const tables = (
      await prisma.$queryRawUnsafe<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`,
      )
    ).map((row) => row.tablename);

    // The backup must describe the database as it is right now.
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}"`);
      counts[table] = n;
    }
    const changed = tables.filter((t) => counts[t] !== (backup.meta.counts[t] ?? 0));
    if (changed.length > 0) {
      fail(`the database changed since the backup (${changed.map((t) => `${t}: ${backup.meta.counts[t] ?? 0} -> ${counts[t]}`).join(', ')}). Take a new backup first.`);
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const phrase = `DELETE ALL DATA IN ${db} ON ${host}`;
    console.log(`\nDatabase: ${db} on ${host}`);
    console.log(`Backup:   ${backupPath} (taken ${backup.meta.createdAt}; row counts match)`);
    console.log(`Rows to delete: ${total}`);
    console.log(`  ${Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join('  ')}`);
    if (process.env.RESET_CONFIRM !== phrase) {
      fail(`set RESET_CONFIRM exactly to:\n\n  ${phrase}\n\nand run again. Nothing has been deleted.`);
    }

    // TRUNCATE empties the tables without firing row triggers (the
    // append-only and "setup stays completed" guards exist to stop the app,
    // not this explicit reset). One statement, one transaction.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
      for (const table of tables) {
        const [{ n }] = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}"`);
        if (n !== 0) throw new Error(`"${table}" still has ${n} row(s); rolled back.`);
      }
    }, { timeout: 120_000, maxWait: 30_000 });

    const [{ users }] = await prisma.$queryRawUnsafe<{ users: number }[]>('SELECT count(*)::int AS users FROM users');
    console.log(`\nDone: ${total} rows deleted; ${users} accounts remain. Tables and migrations are untouched.`);
    console.log('Next: open the site — it shows first-time setup. Set SETUP_KEY in the deployment first if it is public.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
