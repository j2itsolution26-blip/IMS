/**
 * Where passkeys may be used: the WebAuthn relying party (RP) and the exact
 * origins allowed to run the ceremonies.
 *
 * A passkey is bound to its RP ID — a domain — by the authenticator itself.
 * One registered on `localhost` will never work on the production domain, and
 * `vercel.app` is a public suffix, so a Vercel project's production domain,
 * branch alias and per-deployment URLs cannot share passkeys either. Passkeys
 * are therefore offered on the configured origins only; every other host keeps
 * password sign-in.
 *
 *   PASSKEY_RP_ID   e.g. ims-sepia-pi.vercel.app (a bare hostname, no scheme)
 *   PASSKEY_ORIGIN  e.g. https://ims-sepia-pi.vercel.app — comma-separated,
 *                   each an exact origin on the RP ID or a subdomain of it
 *
 * On Vercel both must be set, or passkeys stay off: that is how a deployment
 * opts in once its database has the passkeys table. Elsewhere they default to
 * localhost, the only plain-http origin browsers allow WebAuthn on.
 *
 * Pure (no server imports) so the rules are unit-tested directly.
 */

export interface PasskeyConfig {
  enabled: boolean;
  rpID: string;
  /** Exact origins; WebAuthn verification accepts these and nothing else. */
  origins: string[];
  /** Why passkeys are off, for logs and the diagnostics page. */
  reason: string | null;
}

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEV_DEFAULT = { rpID: 'localhost', origins: ['http://localhost:3000'] };

const off = (reason: string): PasskeyConfig => ({ enabled: false, rpID: '', origins: [], reason });

/** True when `host` is the RP ID or a subdomain of it — the WebAuthn rule. */
export function hostMatchesRpId(host: string, rpID: string): boolean {
  return host === rpID || host.endsWith(`.${rpID}`);
}

/**
 * Parses one configured origin, accepting only an exact `scheme://host[:port]`
 * — no path, no wildcard — over https, or http on a loopback host.
 */
function parseOrigin(value: string): { origin: string; hostname: string } | null {
  if (value.includes('*')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // `new URL('https://a.com/x').origin` drops the path; refuse it rather than
  // silently trusting a value that was not written as an origin.
  if (url.origin !== value.replace(/\/$/, '')) return null;
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  return secure ? { origin: url.origin, hostname: url.hostname } : null;
}

export function resolvePasskeyConfig(env: Env): PasskeyConfig {
  const onVercel = Boolean(env.VERCEL);
  const rawRpId = env.PASSKEY_RP_ID?.trim();
  const rawOrigins = env.PASSKEY_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];

  if (!rawRpId && rawOrigins.length === 0) {
    return onVercel
      ? off('PASSKEY_RP_ID and PASSKEY_ORIGIN are not set for this deployment.')
      : { enabled: true, ...DEV_DEFAULT, reason: null };
  }
  if (!rawRpId || rawOrigins.length === 0) {
    return off('Set both PASSKEY_RP_ID and PASSKEY_ORIGIN, or neither.');
  }

  const rpID = rawRpId.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(rpID) || rpID.startsWith('.') || rpID.endsWith('.')) {
    return off(`PASSKEY_RP_ID "${rawRpId}" must be a bare hostname such as store.example.com.`);
  }

  const origins: string[] = [];
  for (const raw of rawOrigins) {
    const parsed = parseOrigin(raw);
    if (!parsed) {
      return off(`PASSKEY_ORIGIN "${raw}" must be an exact https origin (or http://localhost), with no path or wildcard.`);
    }
    if (!hostMatchesRpId(parsed.hostname, rpID)) {
      return off(`PASSKEY_ORIGIN "${raw}" is not on the relying party ${rpID}.`);
    }
    origins.push(parsed.origin);
  }

  return { enabled: true, rpID, origins: [...new Set(origins)], reason: null };
}

/** Whether the page being served at `origin` may offer passkeys. */
export function passkeysAvailableAt(config: PasskeyConfig, origin: string | null): boolean {
  return config.enabled && origin !== null && config.origins.includes(origin);
}
