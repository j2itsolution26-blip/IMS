# Sari-Sari POS

A simple point-of-sale and inventory system for a small convenience store,
built with Next.js 15, React 19, TypeScript, Prisma, and PostgreSQL, and
deployable to Vercel.

**Every number in this application is calculated from your own database.**
There is no seed data, no sample catalogue, no mock API, and no placeholder
statistic. A fresh install shows zeros and empty states, and fills in as you
trade — that is the intended behaviour, not a bug.

---

## What it does

| Area | Capability |
|---|---|
| **Point of sale** | Search or scan a product, adjust quantity, apply a discount, pay by cash/GCash/card/other, see change, print a compact receipt. Stock is deducted the instant a sale completes. Every sale is a walk-in sale — there is no customer to select. |
| **Cashier shifts** | Open a shift with a counted starting float, sell through the day, close it with a counted cash amount — the app tells you the expected cash and the difference. |
| **Inventory** | Product name, barcode, SKU, category, cost/selling price, unit (piece, pack, bottle, can, sachet, box, or any you add), current stock, low-stock level, image. Stock In for receiving goods, Stock Adjustment for counts and write-offs, Archive instead of delete. A full append-only movement ledger with running balances. |
| **Sales & refunds** | Invoice history with cashier, payment method, and status (Paid / Refunded / Voided). A refund always ties back to its original sale, restores stock, and records who processed it and when — it never creates a fake new sale. |
| **Dashboard** | Today's sales, transactions, total products, low-stock and out-of-stock counts, today's cash sales, and a daily sales chart. |
| **Reports** | Daily/weekly/monthly sales, best-selling products, sales by payment method, stock report, low-stock report, plus a few more — each exportable to CSV, Excel, and PDF from the same definition that renders on screen. |
| **Security** | Better Auth sessions, database-backed RBAC (Owner / Cashier), per-page and per-action permission checks, rate limiting, and a full audit trail. |

---

## Getting started

### 1. Requirements

- Node.js 20 or newer
- A PostgreSQL database (Supabase recommended)

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase **pooled** connection (port `6543`) with `?pgbouncer=true`. |
| `DIRECT_URL` | yes | Supabase **direct** connection (port `5432`). Prisma Migrate needs a session-level connection that the pooler cannot provide. |
| `BETTER_AUTH_SECRET` | yes | 32+ characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |
| `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` | recommended | Your public origin. On Vercel, `VERCEL_URL` is used when this is absent. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | optional | Product image uploads. Without them the app runs normally and the upload button is replaced by a plain URL field. |

### 4. Create the schema

```bash
npx prisma migrate dev   # applies prisma/migrations
```

### 5. Install system reference data

```bash
npm run db:bootstrap
```

This installs the permission catalogue, the Owner and Cashier roles, the
default settings, the store's single default location, and six starter units
(Piece, Pack, Bottle, Can, Sachet, Box). It creates **no business records** —
no products or sales. It is safe to re-run, and it never overwrites a setting
you have changed.

### 6. Create the owner account

```bash
npm run dev
```

Open <http://localhost:3000/sign-up>. The first account created becomes the
**Owner** with full access. After that the page redirects away and the server
rejects public sign-ups — every subsequent account is created from
**Settings → Users**.

### 7. First-run setup inside the app

In this order:

1. **Products** — add a product and its category/unit inline (there's a "+"
   next to each picker), with cost, selling price, and a low-stock level.
2. Load opening stock via **Inventory → Stock In**, or an opening-balance
   **Stock Adjustment**.
3. **Settings** — store name, address, contact, logo, receipt footer,
   currency (defaults to ₱ PHP), and tax rate.

Open a shift at the POS and you're ready to sell.

---

## Deploying to Vercel

1. Push the repository to GitHub.
2. Import it in Vercel.
3. Add every variable from `.env.example` under **Settings → Environment Variables**.
4. Deploy. The build runs `prisma generate && next build`.
5. Apply migrations against production once:

   ```bash
   npx prisma migrate deploy
   npm run db:bootstrap
   ```

**Use the pooled connection string.** Serverless functions open many short-lived
connections; a direct connection will exhaust the database's connection limit
under load. Keep `DIRECT_URL` pointed at the unpooled port for migrations only.

---

## Architecture

```
prisma/
  schema.prisma          Data model
  bootstrap.ts            Roles, permissions, default settings, default
                          location and units (no demo data)

src/
  app/
    (auth)/              Sign-in and first-run owner setup
    (app)/               Authenticated application — POS, Dashboard,
                          Inventory, Sales, Returns, Reports, Settings
    api/                 Better Auth handler, global search, report exports
  components/
    ui/                  Design-system primitives (shadcn-style, on Radix)
    charts/              Recharts wrappers with the validated palette
    …                    Shared building blocks: data table, forms, page header
  features/<feature>/
    actions.ts           Server actions — permission check, validate, audit
    queries.ts           Reads for that feature
    *.tsx                Feature components
  lib/                   Cross-cutting: auth, permissions, decimals, errors
  server/
    services/            Domain logic — the only place that writes stock
    analytics/           Aggregation queries
    reports/             Report registry and the CSV / Excel / PDF exporters
    crud/                Shared factory for categories and units
```

### The rules this system is built on

**Stock is only ever changed by one function.** `applyStockMovement` in
`src/server/services/inventory-service.ts` is the single writer of
`inventory.quantity`, and it always writes a matching `inventory_transactions`
row inside the same transaction. The ledger and the balance cannot disagree.

**This is a single-location system.** Exactly one `Warehouse` row is seeded
by `db:bootstrap` and every operation resolves it silently server-side — there
is no location picker anywhere in the UI. It is kept as its own table only so
the stock-ledger engine needs no schema changes if multi-location is ever
reintroduced.

**Concurrent movements are serialised.** The inventory row is locked with
`SELECT … FOR UPDATE` before it is read, so two tills selling the last unit at
the same moment cannot both succeed.

**Prices are never trusted from the client.** The POS sends product ids and
quantities. Prices and costs are re-read from the database inside the
checkout transaction.

**Cost is frozen at the moment of sale.** `sale_items.unitCost` and
`sales.costOfGoods` are written at checkout, so changing a product's cost later
never rewrites profit already booked.

**Every sale must be paid in full at checkout.** There is no customer record
and no credit/on-account path — cash, GCash, card, and other payment lines
must add up to at least the total before a sale completes.

**A sale requires an open cashier shift.** `createSale` looks up the current
user's open `CashierShift` and refuses to check out without one.

**Money is `Decimal(18,4)`, never `Float`.** Quantities are `Decimal(18,3)` so
fractional units work without a second code path.

**Permissions are checked on the server, every time.** The middleware only
redirects on cookie presence — it decides nothing. `getCurrentUser` and
`authorize` read the session and role from the database on every page and
every action, and a deactivated account is rejected even with a valid cookie.

**Deleting anything with history is refused, with a reason.** Products with
sales cannot be deleted — the UI explains what is in the way and offers
Archive instead.

**A refund always ties back to its original sale.** It restores stock (unless
marked as damaged goods), sets the sale's status to Refunded, and records who
processed it and when via the audit log — it never creates a fake new sale.

---

## Roles

| Role | Access |
|---|---|
| **Owner** | Everything. Cannot be restricted — it is the recovery path if another role is misconfigured. |
| **Cashier** | POS, sales history, reports. No refunds, no settings. |

Roles and their permissions are editable at **Settings → Roles**. Adding a
capability to `src/lib/permissions.ts` and re-running `npm run db:bootstrap` is
the whole workflow for extending the catalogue — for example, adding a third
role that can process refunds.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:push` | Push the schema without a migration (prototyping only) |
| `npm run db:bootstrap` | Install roles, permissions, default settings, default location, and units |
| `npm run db:studio` | Prisma Studio |

---

## Notes and limitations

- **Timezone.** Day boundaries come from the app server; `date_trunc` buckets
  come from the database session timezone (UTC on Supabase). Deploy both in the
  business's timezone for the trading day to line up exactly.
- **Rate limiting is per-instance.** The limiter holds counters in process
  memory, so on Vercel each serverless instance throttles independently. That is
  enough to blunt credential stuffing and request storms; swap the store in
  `src/lib/rate-limit.ts` for Redis/Upstash if you need a hard global guarantee.
- **Password reset is not implemented.** An administrator creates accounts with
  a starting password at Settings → Users. Adding Better Auth's email flow is
  the natural next step.

## Deployment region

`vercel.json` pins Serverless Functions to `sin1` (Singapore) to sit beside the
Supabase project in `ap-southeast-1`. If you move the Supabase project to
another region, change this to match — a mismatch shows up as slow pages
rather than an obvious error.
