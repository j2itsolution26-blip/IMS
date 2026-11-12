# Offline POS

How TindahanProMax keeps selling when the internet drops, and how those sales
reach the database afterwards. This document is the policy; the code points
here.

Status: **Phase 1 of 6 (server side) is built.** The till does not yet sell
offline. Later phases add the device storage, the offline checkout, the
service worker, the owner's review screen and browser tests.

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

- Offline selling never bypasses sign-in: a device is prepared online by an
  authorised user. No passwords, tokens or PIN hashes are stored on the
  device.
- Browser storage is not protected against someone with access to an unlocked
  device. Use a device passcode and do not share till accounts.
- Browsers may clear site storage (notably iOS Safari after weeks unused, or
  under storage pressure). Local storage is not a backup; sales are only safe
  once synced.
- The rate limiter is per server instance (see `src/lib/rate-limit.ts`).
