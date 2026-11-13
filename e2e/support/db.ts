import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Runs a database step (e2e/support/db-cli.ts) against E2E_DATABASE_URL, the
 * same local database the app under test was started with.
 */

const root = path.resolve(__dirname, '..', '..');

export interface Seed {
  storeId: string;
  username: string;
  password: string;
  soap: string;
  rice: string;
  soapBarcode: string;
}

export interface StoreState {
  sales: { origin: 'ONLINE' | 'OFFLINE'; total: number; localReceiptNumber: string | null; clientRequestId: string | null }[];
  stock: Record<string, number>;
  issues: { kind: string; status: string; resolutionNote: string | null }[];
  devices: { id: string; revoked: boolean }[];
  audits: string[];
}

function step<T>(...args: string[]): T {
  const out = execFileSync(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(__dirname, 'db-cli.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL,
      DIRECT_URL: process.env.E2E_DATABASE_URL,
      // The app's server modules refuse to load outside Next.js without this.
      // Relative to `cwd`: NODE_OPTIONS splits on spaces, which paths may hold.
      NODE_OPTIONS: '--require=./tests/integration/server-only-stub.cjs',
    },
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null') as T;
}

export const db = {
  /** A new store; `offline` switches offline cash sales on. */
  seed: (options: { offline?: boolean } = {}) => step<Seed>('seed', ...(options.offline ? ['offline'] : [])),
  zeroStock: (storeId: string, productId: string) => step<{ ok: true }>('zero-stock', storeId, productId),
  shiftId: (storeId: string) => step<{ id: string }>('shift', storeId).id,
  state: (storeId: string) => step<StoreState>('state', storeId),
};
