import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLATFORM_NOTIFICATION_KINDS,
  badgeLabel,
  notificationTime,
  parseNotificationFilter,
  platformKindTone,
  platformNotificationKey,
  safeNotificationHref,
  storeTypeTone,
} from '@/lib/notifications';

test('the badge is hidden at zero, shows the count up to 99, then 99+', () => {
  assert.equal(badgeLabel(0), null);
  assert.equal(badgeLabel(-3), null);
  assert.equal(badgeLabel(Number.NaN), null);
  assert.equal(badgeLabel(1), '1');
  assert.equal(badgeLabel(99), '99');
  assert.equal(badgeLabel(100), '99+');
  assert.equal(badgeLabel(4321), '99+');
});

test('timestamps read "Just now", then minutes, hours, yesterday', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  assert.equal(notificationTime(ago(5), now), 'Just now');
  assert.equal(notificationTime(ago(59), now), 'Just now');
  assert.equal(notificationTime(ago(5 * 60), now), '5 minutes ago');
  assert.equal(notificationTime(ago(3 * 3600), now), '3 hours ago');
  assert.equal(notificationTime(ago(26 * 3600), now), 'yesterday');
  assert.equal(notificationTime(ago(10 * 86_400), now), 'last week');
});

test('only same-site paths are followed from a notification', () => {
  assert.equal(safeNotificationHref('/system-admin/stores/abc'), '/system-admin/stores/abc');
  assert.equal(safeNotificationHref('https://evil.example/phish'), null);
  assert.equal(safeNotificationHref('//evil.example'), null);
  assert.equal(safeNotificationHref('/\\evil.example'), null);
  assert.equal(safeNotificationHref('javascript:alert(1)'), null);
  assert.equal(safeNotificationHref(null), null);
});

test('the filter defaults to all', () => {
  assert.equal(parseNotificationFilter('unread'), 'unread');
  assert.equal(parseNotificationFilter('all'), 'all');
  assert.equal(parseNotificationFilter('anything'), 'all');
  assert.equal(parseNotificationFilter(undefined), 'all');
});

test('every event has a tone; unknown kinds fall back safely', () => {
  for (const kind of Object.keys(PLATFORM_NOTIFICATION_KINDS)) assert.notEqual(platformKindTone(kind), 'muted', kind);
  assert.equal(platformKindTone('SOMETHING_NEW'), 'muted');
  assert.equal(storeTypeTone('SHIFT_SHORTAGE'), 'destructive');
  assert.equal(storeTypeTone('UNKNOWN'), 'muted');
});

test('event keys are stable for the same event and distinct for different ones', () => {
  const day = new Date('2026-11-05T09:30:00Z');
  assert.equal(platformNotificationKey.storeCreated('s1'), platformNotificationKey.storeCreated('s1'));
  assert.notEqual(platformNotificationKey.storeCreated('s1'), platformNotificationKey.storeCreated('s2'));
  assert.equal(
    platformNotificationKey.trialEnding('s1', day),
    platformNotificationKey.trialEnding('s1', new Date('2026-11-05T23:00:00Z')),
    'one trial-ending notice per trial end date',
  );
  assert.notEqual(platformNotificationKey.paymentVerified('p1'), platformNotificationKey.renewed('p1'));
  assert.notEqual(
    platformNotificationKey.statusChanged('s1', 'SUSPENDED', day),
    platformNotificationKey.statusChanged('s1', 'ACTIVE', day),
  );
  assert.equal(platformNotificationKey.lockout('sess'), platformNotificationKey.lockout('sess'));
});

// --- Authorization and separation ---------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8');

test('the audience comes from the account, never the request', () => {
  const actions = read('src/features/notifications/actions.ts');
  assert.match(actions, /const user = await authenticate\(\)/);
  assert.match(actions, /user\.permissions\.has\('platform\.view'\)\) return \{ scope: 'platform', user \}/);
  assert.match(actions, /user\.permissions\.has\(FINANCIAL_PERMISSION\)\) return \{ scope: 'store', user \}/);
  assert.doesNotMatch(actions, /scope: z\.|userId: z\.|storeId: z\./, 'no audience, user or store id is accepted from input');
  assert.match(actions, /markPlatformNotificationsRead\(user\.id, values\.ids\)/);
});

test('administrator read state is written only for the signed-in administrator', () => {
  const service = read('src/server/platform/platform-notification-service.ts');
  const mark = service.slice(service.indexOf('export async function markPlatformNotificationsRead'));
  assert.match(mark, /reads: \{ none: \{ userId \} \}/);
  assert.match(mark, /data: targets\.map\(\(target\) => \(\{ notificationId: target\.id, userId \}\)\)/);
  assert.doesNotMatch(service, /readAt: new Date\(\)/, 'the old shared read columns are not written');
});

test('platform notifications and their reads are closed to store clients', () => {
  const scope = read('src/lib/tenant/scope.ts');
  assert.match(scope, /PlatformNotification: \{ kind: 'denied' \}/);
  assert.match(scope, /PlatformNotificationRead: \{ kind: 'denied' \}/);
});

test('the header shows one bell, chosen by permission, and the sidebar none', () => {
  const shell = read('src/components/layout/app-shell.tsx');
  assert.equal(shell.match(/<NotificationBell\b/g)?.length, 2, 'one branch each for administrators and owners');
  assert.match(shell, /permissions\.includes\('platform\.view'\) \?/);
  assert.doesNotMatch(read('src/components/layout/sidebar.tsx'), /NotificationBell/);
});

test('a trial ending is never presented to administrators as a debt', () => {
  const reminders = read('src/server/platform/billing-reminders.ts');
  assert.match(reminders, /No paid plan has been chosen\. Nothing is owed unless the owner chooses one\./);
});
