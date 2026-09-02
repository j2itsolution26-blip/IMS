/**
 * Authenticated route probe.
 *
 * An unauthenticated request is redirected by middleware before the page ever
 * renders, so a 307 proves nothing about the page itself. This creates a
 * short-lived Owner account, signs in over HTTP to get a real signed session
 * cookie, requests every sidebar route, and then deletes the account again.
 *
 * Run with the dev server already running:  npm run probe
 */

import { prisma } from '../src/lib/prisma';
import { auth } from '../src/lib/auth';
import { runAsProvisioning } from '../src/lib/provisioning-context';

const BASE = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = '__probe__@localhost.test';
const PASSWORD = 'ProbeAccess1!x';

const ROUTES = [
  '/dashboard',
  '/pos',
  '/products',
  '/products/new',
  '/inventory',
  '/inventory/adjustments',
  '/inventory/movements',
  '/sales',
  '/returns',
  '/reports',
  '/reports/sales-summary',
  '/reports/inventory',
  '/reports/profit',
  '/reports/dead-stock',
  '/settings',
  '/settings/users',
  '/settings/roles',
  '/settings/profile',
];

/**
 * Detail routes can only be probed against a record that exists. Each is
 * skipped (not failed) when the table is empty — an empty table is a legitimate
 * state on a fresh install, not a broken route.
 */
async function dynamicRoutes(): Promise<string[]> {
  const [product, sale, saleReturn] = await Promise.all([
    prisma.product.findFirst({ select: { id: true } }),
    prisma.sale.findFirst({ select: { id: true } }),
    prisma.return.findFirst({ select: { id: true } }),
  ]);

  const routes: string[] = [];
  if (product) routes.push(`/products/${product.id}`, `/products/${product.id}/edit`);
  if (sale) routes.push(`/sales/${sale.id}`);
  if (saleReturn) routes.push(`/returns/${saleReturn.id}`);
  return routes;
}

async function removeProbeAccount() {
  const existing = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!existing) return;
  // Sessions and accounts cascade from the user row.
  await prisma.user.delete({ where: { id: existing.id } });
}

async function main() {
  console.log('Preparing probe account…');
  await removeProbeAccount();

  const ownerRole = await prisma.role.findUnique({ where: { slug: 'owner' }, select: { id: true } });
  if (!ownerRole) throw new Error('Owner role missing — run npm run db:bootstrap first.');

  await runAsProvisioning(async () =>
    auth.api.signUpEmail({ body: { name: 'Probe Account', email: EMAIL, password: PASSWORD } }),
  );
  await prisma.user.update({ where: { email: EMAIL }, data: { roleId: ownerRole.id } });

  console.log('Signing in over HTTP…');
  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    // Better Auth enforces CSRF by requiring a same-origin Origin header.
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  const setCookie = signIn.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');

  if (!signIn.ok || !cookie) {
    console.error(`Sign-in failed: ${signIn.status} ${await signIn.text()}`);
    await removeProbeAccount();
    await prisma.$disconnect();
    process.exit(2);
  }

  const detailRoutes = await dynamicRoutes();
  const allRoutes = [...ROUTES, ...detailRoutes];

  if (detailRoutes.length < 3) {
    console.log(
      `(${3 - detailRoutes.length} detail route(s) skipped — no records exist for them yet)`,
    );
  }

  console.log(`Signed in. Probing ${allRoutes.length} routes…\n`);
  console.log(`${'ROUTE'.padEnd(30)} STATUS  RESULT`);
  console.log('-'.repeat(60));

  const broken: { route: string; status: number; detail: string }[] = [];

  for (const route of allRoutes) {
    let status = 0;
    let detail = '';

    try {
      const response = await fetch(`${BASE}${route}`, { headers: { cookie }, redirect: 'manual' });
      status = response.status;

      if (status >= 400) {
        const body = await response.text();
        // Next renders the error message into the HTML error overlay.
        const match =
          /<h2[^>]*>([^<]{5,200})<\/h2>/.exec(body) ??
          /"message":"([^"]{5,200})"/.exec(body) ??
          /Error: ([^\n<]{5,200})/.exec(body);
        detail = match?.[1]?.trim() ?? '';
      }
    } catch (error) {
      status = -1;
      detail = error instanceof Error ? error.message : String(error);
    }

    const ok = status === 200;
    console.log(`${route.padEnd(30)} ${String(status).padEnd(6)}  ${ok ? 'ok' : '*** BROKEN ***'}`);
    if (!ok) broken.push({ route, status, detail });
  }

  console.log('');
  if (broken.length === 0) {
    console.log(`All ${allRoutes.length} routes rendered successfully.`);
  } else {
    console.log(`${broken.length} route(s) FAILED:\n`);
    for (const failure of broken) {
      console.log(`  ${failure.route}  (HTTP ${failure.status})`);
      if (failure.detail) console.log(`    ${failure.detail}`);
    }
  }

  console.log('\nRemoving probe account…');
  await removeProbeAccount();
  await prisma.$disconnect();
  process.exit(broken.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('Probe failed:', error);
  await removeProbeAccount().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(2);
});
