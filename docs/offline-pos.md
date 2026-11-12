# Offline POS

How TindahanProMax keeps selling when the internet drops, and how those sales
reach the database afterwards. This document is the policy; the code points
here.

Status: **Phases 1-2 of 6 are built**: the server side, and the till's own
sale storage and sync engine. The till does not yet *start* a sale while
offline (Phase 3), but no sale is lost or doubled when the connection drops
or a response is lost mid-checkout. Later phases add offline checkout, the
service worker, the owner's review screen and browser E2E tests.

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
| `GET /api/pos/catalog?deviceId=` | `pos.create` | Download products, barcodes, selling prices, units, this branch's stock, the tax rate and the open shift. Never includes cost prices. `Cache-Control: no-store`. |
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

## Security notes and limitations

- **Totals with tax and an order discount (existing behaviour):** the till
  previews tax on the subtotal *after* the order discount; the server taxes
  the subtotal *before* it. Only when both a tax rate and an order discount
  are used, the server's total differs from the preview (the live receipt
  shows the server's). An as-charged upload of such a sale is flagged
  `TOTAL_MISMATCH`. Aligning the two formulas is a separate decision.

- Offline selling never bypasses sign-in: a device is prepared online by an
  authorised user. No passwords, tokens or PIN hashes are stored on the
  device.
- Browser storage is not protected against someone with access to an unlocked
  device. Use a device passcode and do not share till accounts.
- Browsers may clear site storage (notably iOS Safari after weeks unused, or
  under storage pressure). Local storage is not a backup; sales are only safe
  once synced.
- The rate limiter is per server instance (see `src/lib/rate-limit.ts`).
