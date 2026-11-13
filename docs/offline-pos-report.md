# Offline-first POS: implementation report

Branch `feat/offline-pos`, six phases, 5 feature commits plus this one. Not
merged to `main`, so nothing is in production yet. The working rules are in
[offline-pos.md](offline-pos.md); this report is the summary the
specification asks for.

**Core promise:** every completed sale is saved, online or offline, and is
never lost or recorded twice. The till saves each sale on the device first,
then sends it with its own id. The server records an id only once, and
anything it questions goes to the owner instead of being dropped.

## Definition of done

| # | Requirement | How it is met | Evidence |
| --- | --- | --- | --- |
| 1 | Online sales saved to PostgreSQL and recoverable locally | Every sale goes into the device's IndexedDB outbox before it is sent, then to `/api/pos/checkout` with its id as `clientRequestId`. | e2e `online-retry`; unit `offline-outbox`, `sync-engine` |
| 2 | Offline cash sales saved durably on the device | IndexedDB outbox, written in one transaction with the local receipt number. The till asks the browser to keep the storage (`navigator.storage.persist`). | e2e `offline-open-till`, `cold-start` |
| 3 | Offline sales survive browser restarts | The outbox lives in IndexedDB, not page memory. A reload during an outage (online and cold-start) keeps every pending sale. | e2e `online-retry` (reload while down), `cold-start` (reload offline) |
| 4 | Reconnection syncs pending sales automatically | The sync engine runs on start, on reconnecting, on returning to the tab, after each sale, and on a backoff timer. Background Sync (Chromium) wakes an open app. | e2e `offline-open-till`, `cold-start` (no button pressed) |
| 5 | Retries never duplicate invoices or stock deductions | `sales.clientRequestId` is unique per store; a retry gets the first answer back, and a race is handled. | integration `offline-sync` (repeat uploads); e2e `online-retry`: 3 sales, 3 ids, stock 50 → 47 |
| 6 | Owner dashboards update after sync | An uploaded sale is an ordinary sale, filed at the time it was made, so every dashboard and report includes it. The dashboard also shows a notice while offline sales wait for review. | e2e `owner-review` |
| 7 | Shift reconciliation stays accurate | Closing a shift waits until this cashier's sales are sent, and drawer actions need a connection. A sale arriving after its shift closed stays on that shift; if it was made before the close, an adjustment balances it, and either way it is flagged. | integration `offline-sync` (closed shift); e2e `offline-open-till`, `owner-review` |
| 8 | Payment verification and authorization stay intact | GCash is unavailable offline. Refunds, voids and cash in/out need the server. Every upload is checked again on the server: session, `pos.create`, store, shift owner, branch, device, prices, tax and totals. | integration `offline-sync`; e2e `offline-open-till` |
| 9 | Inventory conflicts are detectable and recoverable | A shortfall is recorded (stock may go negative, as decided) and flagged `STOCK_SHORTFALL` with before and after figures. The owner resolves it with a note and corrects the count with a stock adjustment. | e2e `owner-review` (stock −1, flagged, resolved) |
| 10 | Automated tests show all of the above | See "Tests and results". | — |

The spec requires a test with the internet disconnected and restored. That
was done in a real browser for every offline path:
- connection lost while the till was open;
- the till opened with no connection at all;
- a lost response;
- a full outage, including a reload.

## What already existed (kept and built on)

- Idempotent checkout: a unique `clientRequestId` per store, a lookup for a
  retried sale, and handling of the race between two copies of the same sale.
- An installable PWA with a service worker that cached only build files and
  showed an offline page.
- Shift opening, closing and owner review, adjustments, and the drawer
  calculations.
- A store-scoped database client with `tenant_guard` triggers, roles and
  permissions, rate limiting, and the audit log.

## Changes by phase

| Phase | Commit | Summary |
| --- | --- | --- |
| 1 | `d7e8558` | Server: migration, upload API (`/api/pos/sync`), device registry, sync-issue review queue, rules for recording an offline sale |
| 2 | `70c43d1` | Device: IndexedDB outbox, sync engine (backoff, cross-tab lock), stable checkout route, sync status chip, PENDING SYNC receipt |
| 3 | `0b053db` | Offline cash selling: settings, device preparation, catalogue copy, local search and scanning, stock estimate, offline rules in the till and the shift dialogs |
| 4 | `02fc44d` | Service worker v5: cold-start offline till (`/pos-offline`), safe updates, Background Sync, sign-out clears the device's till |
| 5 | `c9ada80` | Owner review (`/sales/offline`): resolve flagged sales, remove or allow devices; offline markers in the sales list, sale page, shift report and dashboard |
| 6 | this commit | Playwright browser suite (`e2e/`), documentation, this report |

### Changed files (against `main`)

**Database**
- `prisma/schema.prisma`
- `prisma/migrations/20261120090000_offline_pos/migration.sql`

**Server**
- New services:
  - `src/server/services/offline-sale-service.ts`
  - `src/server/services/pos-device-service.ts`
  - `src/server/services/pos-catalog-service.ts`
  - `src/server/services/sync-review-service.ts`
  - `src/server/pos/http.ts`
- New routes: `src/app/api/pos/{sync,checkout,devices,catalog}/route.ts`
- Changed:
  - `src/server/services/sale-service.ts`
  - `src/server/services/inventory-service.ts` (`allowNegative`)
  - `src/server/services/shift-service.ts`
  - `src/server/platform/demo-service.ts`
  - `src/middleware.ts` (JSON 401 for `/api/pos/*`)
  - `src/lib/rate-limit.ts`
  - `src/lib/tenant/scope.ts`
  - `src/lib/audit-log.ts`
  - `src/lib/settings-definitions.ts`

**Shared rules (pure, unit-tested)**
- `src/lib/offline-sale.ts`
- `src/lib/offline-catalog.ts`
- `src/lib/sync-review.ts`
- `src/features/pos/checkout-schema.ts`

**Device**
- `src/features/offline/`:
  - `local-db.ts`, `outbox.ts`, `sync-engine.ts`, `sync-client.ts`, `sync-agent.tsx`
  - `sync-status-model.ts`, `sync-status.tsx`
  - `catalog.ts`, `catalog-client.ts`, `offline-till.tsx`
  - `review-actions.ts`, `review-controls.tsx`
- `src/features/pwa/offline-till-cache.ts`
- `src/features/pwa/offline-banner.tsx`
- `public/sw.js`

**Pages and components**
- Pages:
  - `src/app/pos-offline/page.tsx`
  - `src/app/(app)/sales/offline/page.tsx`
  - `src/app/(app)/pos/page.tsx`
  - `src/app/(app)/layout.tsx`
  - `src/app/(app)/dashboard/page.tsx`
  - `src/app/(app)/sales/page.tsx`
  - `src/app/(app)/sales/[id]/page.tsx`
  - `src/app/(app)/shifts/[id]/page.tsx`
  - `src/app/(app)/cash-movements/page.tsx`
  - `src/app/(app)/gcash-services/page.tsx`
- POS: `src/features/pos/pos-terminal.tsx`, `receipt.tsx`, `shift-dialogs.tsx`, `actions.ts`
- Sales and shifts:
  - `src/features/sales/queries.ts`, `sale-invoice-rows.tsx`, `sales-tabs.tsx`
  - `src/features/shifts/shift-transactions-table.tsx`
- Sign-out: `src/features/auth/sign-out.tsx`, `lock-screen.tsx`
- Settings: `src/features/admin/settings-sections.ts`

**Tests**
- `tests/offline-sale.test.ts`, `offline-outbox.test.ts`, `sync-engine.test.ts`, `sync-status.test.ts`
- `tests/offline-catalog.test.ts`, `offline-prepare.test.ts`, `sync-review.test.ts`
- `tests/helpers/outbox-draft.ts`
- `tests/integration/offline-sync.integration.ts`
- Updated: `tests/pwa.test.ts`, `branding.test.ts`, `tender.test.ts`
- `e2e/*.spec.ts`, `e2e/support/*`, `playwright.config.ts`

**Tooling**
- `package.json` / `package-lock.json`: `idb`; dev dependencies `fake-indexeddb` and `@playwright/test` 1.57.0
- `.gitignore`: Playwright output

## Migration

`20261120090000_offline_pos` is **additive only**: nothing is deleted and
no existing figure changes.
- **Sales:** gain `origin` (existing rows are `ONLINE`), `deviceId`,
  `localReceiptNumber` and `receivedAt` (backfilled from `createdAt`).
- **New tables:** `pos_devices` and `sync_issues`, with CHECK constraints and
  `tenant_guard` triggers. `sales_tenant_guard` is re-created to cover
  `deviceId`.
- **Rollback:** the steps are in the migration's header.
- **Settings:** the two new ones (`pos.offlineMode` off, `pos.offlineAccessHours`
  72) need no data change: missing settings read as their defaults. Offline
  selling stays off until the owner switches it on.

**Deployment** (not done; it needs you):
1. Take a Supabase backup.
2. Run `npm run db:deploy` against production.
3. Merge `feat/offline-pos` into `main`. That deploys to production through
   Vercel, so it needs your go-ahead.
4. Each store owner switches on *Settings → Sales → Offline cash sales* when
   ready. Each till must then be opened online once to prepare it.

## Tests and results

Last runs on this branch, against a local throwaway PostgreSQL. Never the
production `.env`.

| Check | Result |
| --- | --- |
| Type check (`tsc`) and lint | Clean |
| Unit tests (`npm test`) | 498 / 498 pass |
| Integration (`npm run test:integration`, real HTTP to the app) | 224 pass, 1 skipped (first-time setup suite, which needs its own empty database) |
| Production build | Passes; `/pos-offline` is a static page |
| Browser (`npm run test:e2e`, production build, Chromium, phone screen) | 4 / 4 pass, twice in a row |

Each phase was also run by hand in a real browser before its commit. The
details are in each phase's section of `offline-pos.md`.

## Security decisions

- **Offline selling is opt-in per store**, and only devices the server has
  registered and given a catalogue copy can use it.
- **The server is the authority.** Every upload is checked again. A device
  cannot choose the store, cashier, shift or branch. The server records what
  was charged and flags any difference; it never silently corrects a price
  or total.
- **Cash only offline.** GCash needs the store account checked. Refunds,
  voids, cash in/out, GCash services, and opening or closing shifts all need
  the server.
- **Offline access is limited:**
  - 72 hours by default (1-168), counted from the last download;
  - one cashier per device copy;
  - the branch of the shift that was open.

  It ends when any of these happens:
  - the cashier signs out;
  - the owner removes the device;
  - offline sales are switched off;
  - the account loses `pos.create`;
  - the store is suspended or read-only.

  Sales already on the device always upload, flagged where needed.
- **Nothing secret is stored on the device**: no passwords, tokens or PIN
  hashes. The catalogue copy holds selling prices and stock, never costs or
  other branches' figures.
- **The service worker never caches** `/api`, page data (RSC) or any POST.
  The offline till page is the same static HTML for everyone.
- **Owner-only review.** The page and both actions check
  `FINANCIAL_PERMISSION`. Resolving and removing are audited and never change
  a sale. Pages get a device's 4-character receipt code, not its id.
- **Tenancy:** new tables are store-scoped in the Prisma client and guarded
  by database triggers.
- **Unauthenticated `/api/pos/*` requests** get a JSON 401, so the device
  keeps its sales and asks the cashier to sign in.

## Known limitations

- **Who can open a cold-started till.** Offline, the screen lock cannot be
  checked: PINs are only verified on the server and never stored on the
  device. Anyone holding a prepared device can sell cash until one of the
  events above ends offline access. Mitigation: sign out at the end of each
  shift, use a device passcode, and remove lost devices.
- **Device clock.** The access period is counted from the server's download
  time, but the device checks it against its own clock. A clock set backwards
  extends it. Each sale's time is limited to between when the shift opened
  and when the server receives it.
- **Tax with an order discount** (existing behaviour): the till applies tax
  *after* the order discount and the server *before* it. Such offline sales
  are flagged `TOTAL_MISMATCH`. Waiting on your decision about which is
  right.
- **Browser storage can be cleared** by the browser (iOS Safari after weeks
  unused, or when storage is low). A sale is safe for good only once it is
  synced. The till requests persistent storage, but browsers decide.
- **Background Sync** is Chromium-only, and only wakes an app that is open.
  Otherwise sales are sent the next time the app opens.
- **Cold start:** no product photos (the image optimiser is never cached). A
  real camera scan on a cold-started till is untested; typed and
  scanner-gun scans are tested.
- **Not split by offline/online yet:** the Reports pages and their exports.
  Offline sales are marked in the sales list, sale page, shift report and
  dashboard.
- **Devices** are all labelled "POS device" plus their receipt code; there is
  no rename yet.
- **Catalogue copy** is capped at 20,000 active products per store. Beyond
  that, the device's sync dialog marks the list "first part only", and the
  rest cannot be sold offline.
- **Rate limits** are per server instance (existing behaviour).
- **Real hardware:** tested in desktop Chromium emulating a phone, not yet on
  real Android or iOS devices.

## Remaining work

1. Apply the migration to production (backup first), then merge to `main`
   when you approve.
2. Decide the tax-plus-discount formula, then align the till and the server.
3. Try it on the real tills (Android Chrome first; iPhone Safari if used),
   including a camera scan on a cold start.
4. Optional:
   - device names;
   - an offline/online breakdown in Reports and exports;
   - running the browser suite in CI against a disposable database.
