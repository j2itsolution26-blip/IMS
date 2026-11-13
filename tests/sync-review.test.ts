import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEVICE_IDLE_DAYS, SYNC_ISSUE_ACTION, SYNC_ISSUE_LABEL, deviceCode, deviceKind, deviceState, syncIssueLabel } from '@/lib/sync-review';
import { localReceiptNumber } from '@/features/offline/outbox';

const root = path.resolve(__dirname, '..');

test('every kind of sync issue the schema allows has a label and guidance', () => {
  const schema = readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
  const kinds = /enum SyncIssueKind \{([^}]*)\}/.exec(schema)?.[1].match(/[A-Z_]{3,}/g) ?? [];
  assert.ok(kinds.length >= 7);
  for (const kind of kinds) {
    assert.ok(SYNC_ISSUE_LABEL[kind as keyof typeof SYNC_ISSUE_LABEL], `label for ${kind}`);
    assert.ok(SYNC_ISSUE_ACTION[kind as keyof typeof SYNC_ISSUE_ACTION], `guidance for ${kind}`);
  }
  assert.equal(syncIssueLabel('SOMETHING_NEW'), 'SOMETHING_NEW', 'an unknown kind still shows');
});

test('a device is recognisable by its browser and by the code on its receipts', () => {
  assert.equal(deviceKind('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
  assert.equal(deviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0'), 'Edge on Windows');
  assert.equal(deviceKind(null), 'Unknown browser');

  const id = '3f2a91c0-7d4e-4b8a-9c1d-2e3f4a5b6c7d';
  assert.equal(deviceCode(id), '3F2A');
  assert.ok(localReceiptNumber(id, 12).startsWith(`OFF-${deviceCode(id)}-`), 'the owner’s screen and the receipt agree');
});

test('a device is active, idle when unseen for a while, or removed', () => {
  const now = new Date('2026-11-13T00:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  assert.equal(deviceState({ revokedAt: null, lastSeenAt: daysAgo(1) }, now), 'active');
  assert.equal(deviceState({ revokedAt: null, lastSeenAt: daysAgo(DEVICE_IDLE_DAYS + 1) }, now), 'idle');
  assert.equal(deviceState({ revokedAt: null, lastSeenAt: null }, now), 'idle');
  assert.equal(deviceState({ revokedAt: daysAgo(0), lastSeenAt: daysAgo(0) }, now), 'revoked');
});

test('the owner’s review screens are owner-only and never change the sale', () => {
  const actions = readFileSync(path.join(root, 'src', 'features', 'offline', 'review-actions.ts'), 'utf8');
  assert.equal((actions.match(/await owner\(\)/g) ?? []).length, 2, 'every action checks the owner first');
  assert.match(actions, /authorize\(FINANCIAL_PERMISSION\)/);
  const page = readFileSync(path.join(root, 'src', 'app', '(app)', 'sales', 'offline', 'page.tsx'), 'utf8');
  assert.match(page, /requirePermission\(FINANCIAL_PERMISSION\)/);
  const service = readFileSync(path.join(root, 'src', 'server', 'services', 'sync-review-service.ts'), 'utf8');
  assert.doesNotMatch(service, /\.sale\.(update|delete)|\.inventory\.|\.payment\.(create|update)/, 'resolving touches the issue only');
});
