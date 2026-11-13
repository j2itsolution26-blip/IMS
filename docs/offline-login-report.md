# Offline sign-in on a trusted device: implementation report

Branch `feat/offline-pos`, after the six offline POS phases. It is not merged
to `main`, so nothing is in production. The working rules are in
[offline-pos.md](offline-pos.md), "Offline sign-in on a trusted device".

Approved decisions:
1. Offline unlock uses each cashier's existing lock-screen PIN, checked by the
   server when it is set up.
2. The default offline access period is 24 hours (it was 72).
3. Signing out keeps the PIN-protected offline access. There is a separate
   *Remove offline access from this device* button.
4. Offline access never runs past the end of the subscription's grace period.

## How sign-in worked before

- **Online sign-in.** Better Auth signs in with username or email and a
  password, using scrypt hashes.
  - Sessions are stored in the database, last 30 days and slide forward with
    use. The cookie cache is off.
  - Every page and action re-reads the account, role permissions, store
    status and subscription, branch and lock state.
  - A disabled account gets the same message as a wrong password. Passkeys
    are optional.
- **Lock screen.** Each cashier sets their own PIN of 4-6 digits; trivial
  ones like 1111 or 1234 are refused.
  - The PIN is hashed with scrypt and checked on the server only.
  - 5 wrong PINs and the PIN stops working; 10 wrong attempts and the session
    is revoked and administrators are notified.
- **Offline POS (phases 1-6).** Devices are registered with the server and
  can be removed by the owner.
  - Each device keeps a catalogue copy with an access period of 72 hours by
    default.
  - Sales go into an IndexedDB outbox and sync idempotently.
  - `/pos-offline` opens with no connection.

**Gaps found:**
1. `/pos-offline` had no authentication. Anyone holding a prepared device got
   the last cashier's till.
2. The lock screen could not be unlocked offline.
3. Signing out removed offline access, so a cashier who signed out last night
   could not work offline the next morning.
4. Only one cashier per device.
5. Coming back online did not check who the browser was signed in as.
6. A clock set backwards extended offline access.
7. Offline access ignored the subscription's end.
8. A changed PIN or permission went unnoticed until the copy expired.
9. A catalogue refresh while the screen was locked returned a plain 403, which
   the device treated as revocation and deleted its copy.

## Changes to sign-in

| When | What happens |
| --- | --- |
| Online, first time | Sign in as before. Opening the till prepares the device: it registers with the server and downloads the catalogue copy. The cashier then allows offline unlock in *Sales on this device → Unlock without internet* by entering their PIN, which the server checks. The device reports itself ready only after the verifier is stored. |
| Offline, device never set up | `/pos-offline` shows **Offline setup required**: an internet connection is needed the first time. The static offline page says the same. Nothing of any till is shown, including when the URL is opened directly. |
| Offline, set up | **Offline sign-in**: username and PIN, then the cashier's own till (cash only, the open shift's branch). Pending-sync count shown. Lock and reload ask for the PIN again. |
| Offline, refused after a correct PIN | **Offline authorization expired**, **No open shift**, **Device not authorized for this account**, or **Offline setup required**. |
| Online lock screen, no connection | The PIN is checked on the device; only the overlay clears, and the lock returns with the connection. |
| Connection returns | The device rechecks every cashier set up on it with the server. Anyone no longer allowed is removed, and the active session ends with **Account revalidation required**. *Open the full till* goes to `/pos` only under the same cashier's session; otherwise to sign in, after signing out anyone else. |
| Sign out (online) | Offline access stays, protected by the PIN. Pending sales stay. |
| Remove offline access (sync dialog) | This cashier's price list and unlock leave the device. Sales stay. |

Offline, a cashier cannot create accounts, change roles, reset passwords or
grant permissions; those screens need the server. The cached permissions
come from the server and are only ever checked against.

## Access period and lockout

- **Access period:** `pos.offlineAccessHours`, 24 hours by default (1-168).
  - It is counted from the last successful download from the server (refreshed
    every 10 minutes while online).
  - The server caps it at the store's end of grace period.
  - It is checked at every offline sign-in, and unlocking never extends it.
  - Stores that saved their own value keep it.
- **Lockout:** counted for the whole device, so it reveals no usernames.
  - 5 wrong PINs in a row, then a 1-minute pause, doubling with each further
    miss up to 30 minutes.
  - After 15, every offline unlock on the device is erased and an online
    sign-in is needed.
  - A correct PIN resets the count. Each attempt is counted *before* the PIN
    is checked.
- **Clock:** unlock is refused if the device clock is more than 5 minutes
  behind the latest time the device has seen.

## How the PIN is protected on the device

- The device stores a **PBKDF2-SHA-256 verifier** made with WebCrypto:
  600,000 iterations, a random 16-byte salt, and the iteration count stored so
  it can be raised later. It is compared in constant time.
- It never stores the PIN, the password, the server's PIN hash or any token.
  A unit test checks every store for the PIN.
- The **PIN fingerprint** (an HMAC of the server's hash under
  `BETTER_AUTH_SECRET`) lets the device notice a changed PIN without learning
  anything about it.
- The lock-screen PIN is separate from the account password. The password is
  never used offline.

## Database migrations

**None.** No PostgreSQL changes. The device database moves from IndexedDB
version 2 to 3 by adding an `unlock` store; the upgrade only adds, and unit
tests check that sales survive it.

## Files changed

New:
- `src/lib/offline-unlock.ts`: rules, key derivation, lockout and clock guard
- `src/features/offline/offline-unlock.ts`: allowing unlock, unlocking, revalidation
- `src/features/offline/offline-unlock-setup.tsx`: *Unlock without internet* in the sync dialog
- `src/server/services/offline-unlock-service.ts` and `src/server/services/pin-fingerprint.ts`
- `src/app/api/pos/offline-unlock/route.ts`, `.../offline-unlock/status/route.ts`, `src/app/api/pos/session/route.ts`
- `tests/offline-unlock.test.ts`, `tests/integration/offline-unlock.integration.ts`, `e2e/offline-unlock.spec.ts`
- `docs/offline-login-report.md`

Changed:
- `src/features/offline/offline-till.tsx`: sign-in gate, states, revalidation, safe handover
- `src/features/offline/local-db.ts` (version 3), `catalog.ts` (which refusals withdraw), `catalog-client.ts`, `sync-status.tsx`
- `src/features/auth/lock-screen.tsx`, `screen-lock.tsx`, `locked-view.tsx` (offline fallback), `sign-out.tsx` (keeps offline access)
- `src/lib/offline-catalog.ts` (capped `accessUntil`, `permissions`, `autoLockMinutes`, `pinFingerprint`)
- `src/lib/store-access.ts` (`sellingEndsAt`), `src/lib/errors.ts` and `src/lib/session.ts` (`SESSION_LOCKED`)
- `src/server/services/pos-catalog-service.ts`, `src/app/api/pos/catalog/route.ts`
- `src/lib/settings-definitions.ts` (24-hour default), `src/middleware.ts` (status endpoint without a session)
- `public/sw.js` (VERSION v6), `public/offline.html` (setup message)
- `eslint.config.mjs` (the two new services may read the platform client, each saying why)
- Tests: `tests/offline-prepare.test.ts`, `branding.test.ts`, `sign-out.test.ts`, `tests/integration/offline-sync.integration.ts`; `e2e/cold-start.spec.ts`, `e2e/support/*`
- `docs/offline-pos.md`

## Tests and results

All runs used a local throwaway PostgreSQL (`localhost:54333/ims_test`) and a
production build with every `.env` value overridden locally. The production
`.env` was never used.

| Check | Result |
| --- | --- |
| Type check, lint | Clean |
| Unit tests (`npm test`) | 517 / 517 pass (26 new in `offline-unlock.test.ts`) |
| Integration: `offline-unlock` + `offline-sync` (real HTTP to the app) | 42 / 42 pass |
| Production build | Passes; `/pos-offline` is still a static page |
| Browser (`npm run test:e2e`, Chromium, phone screen, production build) | 8 / 8 pass, twice in a row |

The browser tests cut the network with Playwright (`context.setOffline`) on a
prepared device:

| Requirement | Shown by |
| --- | --- |
| First-time sign-in while offline is refused | e2e: no unlock set up → *Offline setup required*, nothing of the till shown; unit: an unprepared device refuses; enrolling offline returns `NETWORK` |
| Opening a protected route directly cannot get around sign-in | e2e: `/pos-offline` opened directly shows no products |
| A previously authorized device unlocks offline | e2e: signed out online, then offline sign-in, sale, Lock, reload |
| Wrong PINs are rate-limited | e2e: 5 wrong → "try again in 1 minute", button disabled; unit: schedule, wait, reset, erase after 15 |
| Expired offline authorization blocks new sessions | e2e: clock +25 h → *Offline authorization expired*; unit: unlocking never extends |
| Offline access cannot grant new permissions | unit: a copy without `pos.create` is refused; permissions come only from the server |
| Disabled accounts are revalidated when online | e2e: account disabled while offline → removed on reconnection; integration: disabled, PIN changed, device removed, offline sales off, store suspended all report invalid |
| Subscription and branch restrictions hold | integration: access period capped at the grace end; branch mismatch invalid; unit: shift branch checked |
| Pending sales survive sign-out and failed authentication | e2e: sale kept through Lock, reload, and coming back online signed out, then synced after sign-in; unit: removal and erasure keep sales |
| Reconnecting does not duplicate sales | e2e: exactly one OFFLINE sale, stock 50 → 49 (this spec and cold start) |
| Cached data is kept apart by store and branch | unit: two stores' cashiers on one device each open only their own copy; one cashier's PIN never opens another's till |

## Security limitations that remain

- **This is a counter-side gate, not hardware security.** Someone who copies
  the browser's storage can try all 10⁴-10⁶ PINs against the verifier on
  their own computer within minutes, because PBKDF2 slows guessing but cannot
  stop it. Someone with developer tools on the device can get around checks
  that run in the browser.
- **No instant revocation while offline.** A disabled cashier, removed device
  or lapsed store is enforced only when the device next reaches the server,
  and at the latest when the access period (24 hours) ends.
- **Shared devices:** catalogue copies of every cashier set up on a device stay
  in its storage (selling prices and stock only, never costs). Use personal
  PINs and *Remove offline access* on shared or at-risk devices.
- **Clock:** the guard catches a clock moved back after the device has seen
  the correct time. It cannot catch a clock that was already wrong when the
  copy was downloaded.
- **Status endpoint:** it needs no session and is rate-limited per instance
  (as is the existing rate limiter). It can only remove access, and needs the
  device id plus each cashier's fingerprint.
- **Browser storage can be cleared** by the browser. A sale is safe for good
  only once synced (unchanged).
- **Not yet on real hardware:** tested in desktop Chromium emulating a phone,
  not yet on real Android or iOS tills.
- **Existing behavior unchanged:** offline, a sale's upload still needs the
  cashier's own online sign-in, so sales from a signed-out cashier wait until
  they sign in.
