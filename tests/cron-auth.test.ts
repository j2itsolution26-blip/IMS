import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAuthorizedCron } from '@/lib/cron-auth';

const SECRET = 'a3f9c1e07b2d4c88a3f9c1e07b2d4c88';

test('the job runs only with the configured bearer secret', () => {
  assert.equal(isAuthorizedCron(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(isAuthorizedCron(SECRET, SECRET), false, 'the Bearer prefix is required');
  assert.equal(isAuthorizedCron(null, SECRET), false);
  assert.equal(isAuthorizedCron('', SECRET), false);
});

test('with no secret, or a short one, every call is refused', () => {
  assert.equal(isAuthorizedCron('Bearer anything', undefined), false);
  assert.equal(isAuthorizedCron('Bearer ', ''), false);
  assert.equal(isAuthorizedCron('Bearer short', 'short'), false);
});

test('the billing job is scheduled daily and its route checks the secret', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: { path: string; schedule: string }[] };
  assert.deepEqual(vercel.crons, [{ path: '/api/cron/billing', schedule: '0 1 * * *' }]);
  const route = readFileSync('src/app/api/cron/billing/route.ts', 'utf8');
  assert.match(route, /isAuthorizedCron\(request\.headers\.get\('authorization'\), process\.env\.CRON_SECRET\)/);
  assert.match(route, /status: 401/);
});
