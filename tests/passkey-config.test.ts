import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostMatchesRpId, passkeysAvailableAt, resolvePasskeyConfig } from '@/lib/passkey-config';
import { passkeyLabelFromUserAgent } from '@/lib/passkey-label';

const PROD = 'ims-sepia-pi.vercel.app';

test('local development defaults to localhost', () => {
  const config = resolvePasskeyConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.rpID, 'localhost');
  assert.deepEqual(config.origins, ['http://localhost:3000']);
});

test('on Vercel passkeys stay off until both settings are present', () => {
  assert.equal(resolvePasskeyConfig({ VERCEL: '1' }).enabled, false);
  assert.equal(resolvePasskeyConfig({ VERCEL: '1', PASSKEY_RP_ID: PROD }).enabled, false);
  assert.equal(resolvePasskeyConfig({ VERCEL: '1', PASSKEY_ORIGIN: `https://${PROD}` }).enabled, false);

  const config = resolvePasskeyConfig({ VERCEL: '1', PASSKEY_RP_ID: PROD, PASSKEY_ORIGIN: `https://${PROD}` });
  assert.equal(config.enabled, true);
  assert.equal(config.rpID, PROD);
  assert.deepEqual(config.origins, [`https://${PROD}`]);
});

test('origins must be exact: no wildcard, path, plain http or foreign host', () => {
  const bad = [
    'https://*.vercel.app',
    `https://${PROD}/sign-in`,
    `http://${PROD}`,
    'https://evil.example.com',
    // Ends with the RP ID's text, but is not a subdomain of it.
    `https://not${PROD}`,
    'not a url',
  ];
  for (const origin of bad) {
    const config = resolvePasskeyConfig({ VERCEL: '1', PASSKEY_RP_ID: PROD, PASSKEY_ORIGIN: origin });
    assert.equal(config.enabled, false, origin);
    assert.deepEqual(config.origins, [], origin);
  }
});

test('a trailing slash and several origins on the RP are accepted, normalised', () => {
  const config = resolvePasskeyConfig({
    PASSKEY_RP_ID: 'store.example.com',
    PASSKEY_ORIGIN: 'https://store.example.com/, https://pos.store.example.com',
  });
  assert.equal(config.enabled, true);
  assert.deepEqual(config.origins, ['https://store.example.com', 'https://pos.store.example.com']);
});

test('the RP ID must be a bare hostname', () => {
  for (const rpID of ['https://store.example.com', 'store.example.com/x', '.example.com', '*.example.com']) {
    assert.equal(resolvePasskeyConfig({ PASSKEY_RP_ID: rpID, PASSKEY_ORIGIN: 'https://store.example.com' }).enabled, false, rpID);
  }
});

test('http is allowed only on loopback hosts', () => {
  assert.equal(resolvePasskeyConfig({ PASSKEY_RP_ID: 'localhost', PASSKEY_ORIGIN: 'http://localhost:3100' }).enabled, true);
  // A phone on the LAN is not a secure context, so WebAuthn cannot run there.
  assert.equal(resolvePasskeyConfig({ PASSKEY_RP_ID: '192.168.101.4', PASSKEY_ORIGIN: 'http://192.168.101.4:3000' }).enabled, false);
});

test('the button is offered only on a configured origin', () => {
  const config = resolvePasskeyConfig({ VERCEL: '1', PASSKEY_RP_ID: PROD, PASSKEY_ORIGIN: `https://${PROD}` });
  assert.ok(passkeysAvailableAt(config, `https://${PROD}`));
  // The branch alias and per-deployment URLs cannot use the production passkeys.
  assert.ok(!passkeysAvailableAt(config, 'https://ims-git-main-j2-it-sltn26.vercel.app'));
  assert.ok(!passkeysAvailableAt(config, null));
  assert.ok(!passkeysAvailableAt(resolvePasskeyConfig({ VERCEL: '1' }), `https://${PROD}`));
});

test('RP ID matching follows the WebAuthn suffix rule', () => {
  assert.ok(hostMatchesRpId('example.com', 'example.com'));
  assert.ok(hostMatchesRpId('pos.example.com', 'example.com'));
  assert.ok(!hostMatchesRpId('badexample.com', 'example.com'));
});

test('new passkeys get a readable default name', () => {
  const cases: [string | null, string][] = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Mac'],
    [null, 'Passkey'],
  ];
  for (const [ua, label] of cases) assert.equal(passkeyLabelFromUserAgent(ua), label);
});
