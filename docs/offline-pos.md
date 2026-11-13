# Offline POS

How TindahanProMax keeps selling when the internet drops, and how those sales
reach the database afterwards. This document is the policy; the code points
here.

Status: **all seven phases are built** (the seventh, offline sign-in on a
trusted device, is reported in [offline-login-report.md](offline-login-report.md)):
1. The server side.
2. The till's own sale storage and sync engine.
3. Offline cash selling on a prepared till.
4. Opening that till with no connection at all (the service worker).
5. The owner's review of offline sales and devices.
6. Browser tests (`e2e/`).
7. Offline sign-in with the cashier's PIN on a trusted device.

The implementation report is in
[offline-pos-report.md](offline-pos-report.md). Before go-live, apply the
migration to production (see the report, "Deployment").

## Principles

- Every completed sale is saved durably, online or offline, and is never lost
  or recorded twice because of the network.
- PostgreSQL is the source of truth. A device's stock figures are an estimate.
- An offline sale already happened: the goods left the shop and the cash is in
  the drawer. The server therefore **records it as charged** and puts anything
  that does not add up in front of the owner. It does not quietly correct it or
  drop it.

## Endpoints

All three are route handlers, not server actions. A server action's id changes
with every deploy, so a till still running the previous release could not
upload its sales. A URL stays the same.

| Endpoint | Permission | Purpose |
|---|---|---|
| `POST /api/pos/devices` | `pos.create` | Register this browser for offline selling (device id = a UUID made on the device). |
| `GET /api/pos/catalog?deviceId=` | `pos.create` | Only while the owner has offline selling switched on (else 403 `OFFLINE_DISABLED`). Download products, barcodes, selling prices, units, this branch's stock, the tax rate and the open shift. Never includes cost prices. `Cache-Control: no-store`. |
| `POST /api/pos/sync` | `pos.create` | Upload **one** offline sale. Safe to repeat. |
| `POST /api/pos/checkout` | `pos.create` | A live checkout: exactly the `checkout` server action (server prices, stock check, GCash confirmation), at a stable URL. Safe to repeat with the same id. |

Writes must be JSON and same-origin. Without a session cookie, the middleware
answers `/api/pos/*` with a JSON 401, never a redirect to the sign-in page.

### What the till does with each answer (`classifySyncResult`)

| Answer | Meaning | Till action |
|---|---|---|
| 200 `recorded` / `duplicate` | Saved (or already saved) | Store the invoice number against the local id |
| 401 | Session ended | Keep the sale; ask the cashier to sign in |
| 403 | Screen locked, another cashier's sale, store read-only, suspended | Keep; try again when that changes |
| 409 / 422 | The sale itself was refused | Keep and show the reason; never delete |
| 429 / 5xx / no answer | Temporary | Retry with backoff (2 s doubling to 5 min, 20% jitter) |

## On the device (`src/features/offline`)

IndexedDB database `tindahanpromax-pos` (via `idb`):

| Store | Holds |
|---|---|
| `meta` | the device id (a UUID made on first use), the local receipt counter, the last successful sync |
| `outbox` | every sale the till completes, keyed by its local id, with store, cashier, the live checkout request, the as-charged copy (cash only), the receipt, status, attempts and the server's answer |
| `syncLog` | one line per send attempt and its outcome |

**Every sale goes through the outbox, online too.** At checkout the till:

1. Saves the sale on the device in one IndexedDB transaction (entry and local
   receipt number `OFF-XXXX-000123` together, or nothing).
2. Sends it to `/api/pos/checkout` with its local id, up to 3 times over about
   5 seconds while the customer waits.
3. Acts on the answer:
   - **Confirmed:** shows the receipt with the server's invoice number, as before.
   - **Clearly refused** (no stock, shift closed, etc.): the cashier sees why
     and nothing is charged. The entry is kept as `declined` and never sent.
   - **No answer** (lost response, dropped connection, server error): the sale
     is kept as **PENDING SYNC**, the customer gets a receipt marked so, and
     the sync engine sends it again with the same id until the server has it.
     A cash sale goes up as charged through `/api/pos/sync`; GCash keeps
     retrying the live checkout. The same id can never record two sales,
     across both endpoints.

If the browser cannot store anything (some private windows, blocked site
data), the till says so and checks out straight against the server as it did
before Phase 2.

The **sync engine** sends unsent sales oldest first:
- **When:** on app start, reconnection, return to the tab, after each sale,
  on its own backoff timer, and from the Retry button.
- **Who:** only the signed-in cashier's sales for their store. Another
  cashier's sales on the same device wait for that cashier to sign in.
- **One sender:** only one tab sends at a time (Web Locks).
- **When the server is down:** a pass stops at the first unanswered request.
- **When the session has expired:** the pass stops at the first 401.
- **Nothing is deleted** because sending failed. Sent and declined entries are
  pruned after 30 days; unsent and refused ones never are.

**Status chip** (POS header): *Checking…*, *Online · Synced*, *Online · n
pending*, *Synchronizing*, *Sync error · n*, *Offline (· n pending)*, *Not
saving on device*. "Online" requires an answer from the server, not just
the browser's network flag. Its dialog lists unsent sales with the reason,
Retry, the last successful sync, and recently sent local → invoice numbers.

## Offline selling (Phase 3)

**Switched on by the owner:** Settings → Sales → *Offline cash sales*
(`pos.offlineMode`, off by default), with *Offline access period*
(`pos.offlineAccessHours`, 24 by default since Phase 7 (it was 72), 1-168).
Stores that saved their own value keep it.

**Preparing a device:** a till opened online with offline sales switched on
prepares itself:
1. It registers its device id.
2. It downloads the catalogue copy into IndexedDB (`catalog` store, one copy
   per store and cashier).
3. It refreshes the copy every 10 minutes and when the connection returns.

The sync dialog shows the copy (product count, download time, *offline
until*) with Prepare / Refresh. A 403 refusal (switched off, device revoked,
store read-only or suspended, account no longer allowed) **removes the copy**
and the cashier's offline unlock. A network failure keeps both, and so do a
401 (this browser is signed out, which says nothing about the cashier whose
copy it is) and a 403 `SESSION_LOCKED` (the screen is locked). Removing the
copy never touches saved sales.

**A till may sell offline only when all of these hold** (`offlineReadiness`):
- offline sales are switched on (as last seen online);
- the copy is this store's and this cashier's;
- the copy is within its access period (counted from the download);
- the copy is for the branch of the open shift.

Otherwise the chip reads **Offline setup required** and Charge stays disabled.

**What works offline:**
- Searching by name or SKU, and barcode lookup (camera, USB/Bluetooth scanner
  or typed). Barcodes match with pack spacing ignored, as on the server.
  Unknown codes say so.
- Cash checkout. The sale is saved on the device and the receipt is marked
  PENDING SYNC straight away.
- Kilogram, gram, meter and piece quantities, as online.

**What does not work offline:**
- GCash: disabled offline, because it needs the store account checked.
- Refunds, voids, cash in/out, GCash services, and opening or closing a
  shift: these need the server.

**Stock on the device** is an estimate: the copy's figure less the quantities
this device sold since the copy was taken (declined sales excluded). When
the connection returns and sales have reached the server, the grid shows the
server's stock again.

**Closing a shift** is held back while this cashier has unsent sales on the
device, so the count includes them. Sales the server refused only warn: their
cash is in the drawer but not in the expected amount, and they go to the owner.

**Offline banner:** "Cash sales are saved on this device and sent when the
connection returns" on a ready till; otherwise "Changes can't be saved until
the connection returns". Both add the number waiting.

Tested in a real browser on a phone-sized screen. The test:
1. Prepared the till online.
2. Dropped the network.
3. Scanned a barcode and searched by name from the device copy.
4. Charged cash, with GCash shown as disabled.
5. Checked the receipt said PENDING SYNC, the stock estimate dropped, and
   closing the shift was held back.
6. Restored the network.

Result: one OFFLINE sale recorded, filed at the time it was made, with stock
deducted once.

## Opening the till with no connection (Phase 4)

**The offline till** (`/pos-offline`, `src/features/offline/offline-till.tsx`)
is a static page: the same HTML for everyone, with no account data in it.
Since Phase 7 it shows nothing of any till until a cashier signs in with
their username and PIN (see "Offline sign-in" below), and then opens **that
cashier's** catalogue copy. It uses the same rules as a till that lost its
connection while open:
- the offline access period;
- the branch of the shift that was open at the last download;
- cash only.

It shows "Offline sales are not available here" with the reason when:
- nothing is prepared;
- the access period has ended;
- no shift was open at the last download (a shift opens only online).

When the connection returns, it offers *Open the full till*. It never
switches by itself, since a browser can report a connection while the server
is down. Before switching it asks `GET /api/pos/session` who this browser is
signed in as: the same cashier goes to `/pos`; nobody goes to sign in;
anyone else is signed out first, then the cashier signs in.

The receipt header, cashier name and low-stock level come with the catalogue
copy, so a receipt printed from the offline till matches an online one.

**Service worker** (`public/sw.js`, VERSION `v5`):
- **What it keeps:** after each successful preparation the till asks the
  worker to keep the offline till (`CACHE_OFFLINE_TILL`). The worker fetches
  `/pos-offline`, reads the build files it needs from the HTML and the
  page's inline data, and keeps them in `tpm-till-v5`. That cache is never
  trimmed. Files of earlier builds are dropped once a newer till is kept, and
  the page is stored last, so it is never served without its files.
- **When it is used:** a page load that gets **no network at all** redirects
  to the offline till on a device that has it, and gets the offline page
  otherwise. A page the server answered, even with an error, is shown as it
  is.
- **What it never caches:** POST requests, `/api/*`, page data (RSC) and other
  sites. A signed-out device is redirected to sign in when the worker asks for
  the till, so it keeps nothing.
- **Updates:** the new worker waits for *Reload* in the update toast, as
  before. If the device had the offline till, the new worker fetches the new
  version's till while it installs, so the till still opens offline after
  the update.
- **Background Sync** (Chromium): an offline sale registers the `tpm-outbox`
  tag. When the connection returns, the browser wakes the worker, which tells
  the open app to send. The app's own sync engine does all sending; the worker
  never uploads a sale. With no window open, sales are sent the next time the
  app opens.

**Signing out** (menu or lock screen) keeps the cashier's PIN-protected
offline access (Phase 7), so they can still work offline the next morning.
It ends with the access period, on *Remove offline access from this device*
in the sync dialog, or when the server withdraws it. Unsent sales always
stay on the device and are sent at the next sign-in.

**Offline, the shift bar** disables Cash in, Cash out, GCash in/out and Close
shift ("Needs a connection"), and a till with no open shift cannot open one.

Tested in a real browser (production build, phone-sized screen):
1. Prepared the till online; the worker kept the till (33 files, no `/api`
   or RSC entries).
2. Cut the network and opened `/pos`: it redirected to the offline till,
   showing "Offline · Sales available".
3. Scanned a barcode and confirmed the shift actions and GCash were disabled.
4. Charged cash and got a PENDING SYNC receipt with the cashier's name.
5. Reloaded while still offline: the sale was still pending.
6. Opened another page offline: it also redirected to the till.
7. Restored the network: the sale synced.

Result: one OFFLINE sale and stock deducted once. The Phase 2 and Phase 3
browser runs pass unchanged on the same build.

## Recording rules (`recordOfflineSale`)

Recorded, with a `sync_issues` row for the owner:

| Situation | Issue | What happens |
|---|---|---|
| Not enough stock / stock goes below zero | `STOCK_SHORTFALL` | Stock is deducted anyway (bypassing the store's negative-stock setting for this sale only) |
| Price the product did not have between the device's catalogue download (at most 7 days earlier) and the sale | `PRICE_MISMATCH` | Recorded at the price charged |
| Device tax rate is not the store's | `TAX_RATE_MISMATCH` | Totals use the device's rate |
| Device total is not the server's sum | `TOTAL_MISMATCH` | Recorded at the server's sum; change recomputed |
| Product archived or deactivated since | `PRODUCT_UNAVAILABLE` | Recorded |
| Shift already closed | `CLOSED_SHIFT` | See below |
| Device revoked by the owner | `DEVICE_REVOKED` | Recorded |

Refused (kept on the device): another cashier's sale (403 `OTHER_CASHIER`, which
uploads when that cashier signs in); a shift that is not the uploader's
(`SHIFT_NOT_FOUND`); a branch that does not match the shift
(`BRANCH_MISMATCH`); a product that no longer exists (`PRODUCT_NOT_FOUND`); a
fraction of a whole-unit product; cash below the device's own total
(`UNDERPAID`); a device id belonging to another store (409); a lapsed
(read-only) store (403 `STORE_READ_ONLY`), which uploads after renewal.

Other rules:

- **Cash only.** GCash needs the store account checked, which needs a
  connection. The upload format has no payment method at all.
- **Time.** `createdAt` is when the sale happened, clamped between the shift's
  opening and the server's clock, so every existing report files it on the
  right day. `receivedAt` is when the server recorded it. The payment carries
  the sale time; the stock ledger row is dated when the server applied it.
- **No duplicates.** The local sale id is the `clientRequestId`, unique per
  store. A repeat (a lost response, two tabs, five parallel retries) returns
  the one sale already recorded, with the same invoice number. No second
  payment and no second stock deduction.
- **Branch.** A sale is filed under its shift's branch, never the device's
  current one.
- Prices, totals, stock, payment, issues and the audit entry are written in one
  transaction.

### Closed shifts

A sale can arrive after its shift was closed, for example when the owner
closed it from another device. The closed shift's frozen figures never change.
Instead:

- **Sold before the close:** its cash was in the drawer that was counted, so
  the count showed an overage of that amount. A `ShiftAdjustment` of minus the
  sale's cash is added beside the frozen figures and the shift goes to owner
  review.
- **Sold after the close:** its cash is not in that count. No adjustment is
  made; the issue tells the owner to check the drawer.

### Devices

- Registered by a signed-in account with `pos.create`, filed under that store.
- **Revoking** a device stops catalogue downloads and re-registration, which ends
  its offline access once its cached copy expires. Sales it already took still
  upload, flagged `DEVICE_REVOKED`, so the money taken stays on the books.

## Owner review (Phase 5)

**Sales → Offline sync** (`/sales/offline`, owner only: the page and both
actions require `FINANCIAL_PERMISSION`, and only the owner sees the tab):
- **Summary:** sales waiting for review, offline sales in the last 30 days
  (already counted in sales and reports), and devices.
- **Sales to review:** each flagged offline sale shows:
  - what was found;
  - the invoice and the customer's local receipt number;
  - when it was sold and when it reached the server;
  - the cashier, branch, device and shift;
  - what to check.

  *Resolve* asks what was checked or done. That note, the owner and the time
  are kept, and the change is audited. Resolving **never changes the sale,
  stock or drawer**: corrections are a stock adjustment or a shift adjustment,
  each with its own record. A second resolve of the same issue is refused.
- **Devices:** each device shows:
  - its label and the code it prints on offline receipts (`OFF-3F2A`), which
    ties a paper receipt to the device;
  - its browser, branch, who added it, when it was last seen and last
    uploaded, and its count of offline sales and open issues;
  - its state: active, not seen for 14 days, or removed.

  *Remove* (audited) stops the device getting the catalogue (403
  `DEVICE_REVOKED`). It can no longer sell offline once it next connects, and
  at the latest when its access period ends. Sales it already took still
  upload, flagged. *Allow* reverses a removal.

**Where offline sales show elsewhere:**
- **Sales list:** "Offline sale" under the invoice time.
- **Sale page:** an *Offline sale* card. It shows the customer's receipt
  number, when it was sold, when it reached the server and the device code.
  For the owner, it also lists the flags raised on that sale.
- **Shift report:** each offline sale is marked in the transactions,
  "arrived after close" when it reached the server after the shift closed. A
  note counts the shift's offline sales. It explains that a late sale's cash
  was not in the expected amount at close, and that a sale made before the
  close is balanced by the listed adjustment.
- **Owner dashboard:** a notice when offline sales are waiting for review.

Tested in a real browser (production build, phone-sized screen):
1. Prepared the till, then set a product's stock to 0 on the server.
2. Sold it offline and reconnected.
3. Checked the dashboard notice and the sales-list marker.
4. On the review page: the "Stock went below zero" flag and the device with
   its receipt code.
5. Resolved it with a note.
6. Checked the sale page and the shift-report note.
7. Removed the device. The catalogue then answered `403 DEVICE_REVOKED`.

In the database:
- the issue was resolved with the owner and the note;
- the device was revoked by the owner;
- both actions were in the audit log;
- the sale was recorded once, and stock went to −1, flagged as agreed.

## Browser tests (`e2e/`, Phase 6)

Playwright drives a real Chromium on a phone-sized screen against a running
app. Each test seeds its own store through `e2e/support/db-cli.ts`.

| Spec | What it proves |
| --- | --- |
| `online-retry.spec.ts` | A normal sale, a lost response and a full outage with a reload in the middle each end up recorded exactly once (3 sales, 3 distinct ids, stock 50 → 47). |
| `offline-open-till.spec.ts` | With the connection cut while the till is open, the device can still: scan and search its copy, take cash only, show the stock estimate, and keep the drawer actions waiting. Reconnecting syncs one OFFLINE sale. |
| `cold-start.spec.ts` | A prepared till opens with no connection, after offline sign-in. No API or page data is in any cache. A sale stays through an offline reload and syncs once. Skipped on a development server, which has no service worker. |
| `owner-review.spec.ts` | A stock shortfall is flagged. It shows on the dashboard notice, the sales list, the review page, the sale page and the shift report. It is resolved with a note. Removing the device makes the catalogue answer 403 `DEVICE_REVOKED`. The audit log has both actions. |
| `offline-unlock.spec.ts` | Offline sign-in: refused on a device never set up (also by direct URL); a signed-out cashier unlocks with their PIN, sells, locks, reloads and syncs exactly once after signing in; wrong PINs pause; expired access refuses the right PIN; a disabled account is dropped on reconnection. |

**Running them.** Use a local, throwaway database only. The tests refuse any
database or app that is not on `localhost`.

```bash
npx playwright install chromium          # once per machine
# A local Postgres with the migrations applied and bootstrapped, then the app
# built and started against it (production build, for the cold-start test):
DATABASE_URL=postgresql://postgres@localhost:54333/ims_test npm run build
DATABASE_URL=postgresql://postgres@localhost:54333/ims_test npx next start -p 3107
# In another terminal:
E2E_DATABASE_URL=postgresql://postgres@localhost:54333/ims_test E2E_BASE_URL=http://localhost:3107 npm run test:e2e
```

The app also needs the usual auth variables (`BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`) pointing at the local URL. Never
point any of this at the production `.env`.

## Security notes and limitations

- **Who can open the offline till:** only a cashier who allowed offline
  unlock on this device while online, with their username and PIN, until
  their access period ends or the server withdraws it. The PIN check runs in
  the browser; see "Offline sign-in" for what that does and does not protect
  against. Keep tills physically secure.
- **Not available on a cold start:** product photos (served through the image
  optimiser, which is never cached) and anything other than the till.
  The camera scanner's code ships with the till's files. A real camera scan
  on a cold-started till has not been tested; typed and USB/Bluetooth scans
  have.

- **Totals with tax and an order discount (existing behaviour):** the till
  previews tax on the subtotal *after* the order discount; the server taxes
  the subtotal *before* it. Only when both a tax rate and an order discount
  are used, the server's total differs from the preview (the live receipt
  shows the server's). An as-charged upload of such a sale is flagged
  `TOTAL_MISMATCH`. Aligning the two formulas is a separate decision.

- Offline selling never bypasses sign-in: a device is prepared online by an
  authorised user. No passwords, tokens, PINs or server PIN hashes are stored
  on the device; offline unlock keeps only its own salted PBKDF2 verifier.
- Browser storage is not protected against someone with access to an unlocked
  device. Use a device passcode and do not share till accounts.
- Browsers may clear site storage (notably iOS Safari after weeks unused, or
  under storage pressure). Local storage is not a backup; sales are only safe
  once synced.
- The rate limiter is per server instance (see `src/lib/rate-limit.ts`).

## Offline sign-in on a trusted device (Phase 7)

Rules: `src/lib/offline-unlock.ts`. Device: `src/features/offline/offline-unlock.ts`.
Server: `src/server/services/offline-unlock-service.ts` and `pin-fingerprint.ts`.

**Allowing it (online only).** On a prepared till, *Sales on this device →
Unlock without internet* asks for the cashier's own screen-lock PIN.
`POST /api/pos/offline-unlock` checks it against the stored scrypt hash. It
requires a session, `pos.create`, offline sales switched on, a writable
store, and this device registered to the store and not removed. It answers
with a **PIN fingerprint**: an HMAC of that hash under `BETTER_AUTH_SECRET`.
The device then makes a random 16-byte salt and keeps a PBKDF2-SHA-256
verifier (600,000 iterations, WebCrypto) in the `unlock` store (IndexedDB
version 3). Allowing it is recorded in the audit log against the device. A
cashier with no PIN is told to set one in their profile.

**Signing in offline** (`/pos-offline`). Username and PIN. Nothing of any till
shows before that. The device opens the cashier's own copy only if:
- it is unexpired (unlocking never extends it);
- it lists `pos.create`;
- it has an open shift;
- it is for that shift's branch.

A wrong PIN and an unknown username get the same message ("Username or PIN
is incorrect.") and take the same time to check.

| Wrong PINs in a row (whole device) | Effect |
| --- | --- |
| 1-4 | Try again |
| 5 | 1-minute pause, doubling with each further miss, up to 30 minutes |
| 15 | Every offline unlock on the device is erased; an online sign-in is needed. Sales and price lists stay. |

Wrong PINs are counted for the whole device, not per cashier, so the
lockout reveals no usernames. If the device clock is more than 5 minutes
behind the latest time it has seen, unlock is refused. The session lives
only in page memory: Lock, a reload or idle auto-lock (the store's setting,
cached) asks for the PIN again.

**The online lock screen with no connection** checks the PIN against the same
offline unlock. Only the overlay clears; the server still has the session
locked, so the lock returns when the connection does.

**Withdrawn when online.**
- Each catalogue download carries the cashier's current fingerprint. If it
  differs, the device drops that cashier's unlock.
- When the device is online, it asks `POST /api/pos/offline-unlock/status`
  about every cashier set up on it. This happens when the offline till sees
  the connection return, and on every online catalogue refresh. No session
  is needed; each cashier is named by store, id, fingerprint and branch.
- A cashier is removed from the device (copy and unlock; sales stay) if any
  of these is true:
  - the account is disabled, or must change a password an administrator set;
  - the PIN was changed or removed;
  - they moved branch or lost `pos.create`;
  - the device was removed;
  - the store is suspended or read-only, or has offline sales switched off.
- The status endpoint can only take access away. It answers yes or no for
  each cashier named, and is rate-limited per address.

**Subscription.** The server caps the access period at the moment the store
would become read-only (the end of the grace period), so a device cannot
keep selling for a lapsed store.

**What it does not protect against.**
- The check runs in the browser. Someone who copies the browser's storage
  can try every 4-6 digit PIN against the verifier on their own computer
  within minutes.
- Someone with developer tools on the device can get around the checks
  altogether.
- Browser storage is not hardware-backed.
- Revocation cannot reach a disconnected device: the access period (24 hours
  by default) is the limit.

A device passcode, personal PINs and removing lost devices remain essential.
