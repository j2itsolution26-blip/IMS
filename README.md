# Inventory Management System

Stock control, point of sale, purchasing, and business analytics for a real
trading business. Built with Next.js 15, React 19, TypeScript, Prisma, and
PostgreSQL, and deployable to Vercel.

**Every number in this application is calculated from your own database.** There
is no seed data, no sample catalogue, no mock API, and no placeholder statistic.
A fresh install shows zeros and empty states, and fills in as you trade — that
is the intended behaviour, not a bug.

---

## What it does

| Area | Capability |
|---|---|
| **Point of sale** | Barcode scan, product search, quantity and line discounts, split payments (cash, GCash, Maya, card, bank transfer, on-account), change calculation, printable receipt. Stock is deducted the instant a sale completes. |
| **Inventory** | Per-warehouse stock, reservations, adjustments (stock count or delta), inter-warehouse transfers, and a complete append-only movement ledger with running balances. |
| **Purchasing** | Purchase orders, partial receiving, landed-cost correction, moving-average cost recalculation, supplier payments, and automatic late-delivery detection. |
| **Sales** | Invoice history, per-line profit, void with stock reversal, partial and full returns with optional restock. |
| **Products** | SKU, barcode, images, category / brand / unit / supplier, cost and selling price, tax rate, min / max / reorder levels, price-change history. |
| **Dashboard** | Live revenue, profit, transactions, units sold, inventory value, available and reserved stock, low / critical / out-of-stock / dead-stock counts, reorder suggestions with days-of-cover, and generated insights. |
| **Analytics** | Time series, sales by category / brand / supplier / employee / hour, payment-method split, inventory turnover and ageing, best customers, supplier scorecards, most-returned products. |
| **Reports** | 15 reports, each exportable to CSV, Excel, and PDF from the same definition that renders on screen. |
| **Security** | Better Auth sessions, database-backed RBAC with 22 resources, per-page and per-action permission checks, rate limiting, and a full audit trail. |

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
npx prisma migrate dev --name init   # first time — creates prisma/migrations
```

This project ships without a migrations folder because migrations must be
generated against your own database. Run the command above once, then **commit
`prisma/migrations/`** so `prisma migrate deploy` can run in CI and on Vercel.

### 5. Install system reference data

```bash
npm run db:bootstrap
```

This installs the permission catalogue, the five system roles, and the default
settings. It creates **no business records** — no products, customers,
suppliers, sales, or users. It is safe to re-run, and it never overwrites a
setting you have changed.

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

1. **Warehouses** — you need at least one to hold stock or sell anything.
2. **Units** — how products are counted (pieces, kg, cases).
3. **Categories** — every product needs one.
4. **Products** — with cost, selling price, and reorder level.
5. **Suppliers** — so you can raise purchase orders.
6. Load opening stock via **Stock levels → Adjust stock** (tick *Opening
   balance*), or receive it through a purchase order.

The dashboard becomes meaningful as soon as real transactions exist.

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
  schema.prisma          Data model — 23 tables, all of them used
  bootstrap.ts           Roles, permissions, and default settings (no demo data)

src/
  app/
    (auth)/              Sign-in and first-run owner setup
    (app)/               Authenticated application, one folder per route
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
    analytics/           Aggregation queries (raw SQL where it matters)
    reports/             Report registry and the CSV / Excel / PDF exporters
    crud/                Shared factory for the six reference entities
```

### The rules this system is built on

**Stock is only ever changed by one function.** `applyStockMovement` in
`src/server/services/inventory-service.ts` is the single writer of
`inventory.quantity`, and it always writes a matching `inventory_transactions`
row inside the same transaction. The ledger and the balance cannot disagree.

**Concurrent movements are serialised.** The inventory row is locked with
`SELECT … FOR UPDATE` before it is read, so two tills selling the last unit at
the same moment cannot both succeed.

**Prices are never trusted from the client.** The POS sends product ids and
quantities. Prices, tax rates, and costs are re-read from the database inside
the checkout transaction.

**Cost is frozen at the moment of sale.** `sale_items.unitCost` and
`sales.costOfGoods` are written at checkout, so changing a product's cost later
never rewrites profit already booked.

**Money is `Decimal(18,4)`, never `Float`.** Quantities are `Decimal(18,3)` so
fractional units work without a second code path.

**Permissions are checked on the server, every time.** The middleware only
redirects on cookie presence — it decides nothing. `getCurrentUser` and
`authorize` read the session and role from the database on every page and every
action, and a deactivated account is rejected even with a valid cookie.

**Deleting anything with history is refused, with a reason.** Products with
sales, suppliers with orders, categories with products, and users with
transactions cannot be deleted — the UI explains what is in the way and offers
the correct alternative (discontinue, deactivate, reassign).

---

## Roles

| Role | Access |
|---|---|
| **Owner** | Everything. Cannot be restricted — it is the recovery path if another role is misconfigured. |
| **Manager** | All operations. No user, role, or settings changes. |
| **Inventory clerk** | Stock, receiving, adjustments, transfers, catalogue maintenance. |
| **Cashier** | POS, sales, returns, customer lookup. |
| **Accountant** | Read access to trading data, full control of expenses and payments, all reports. |

Roles and their permissions are editable at **Settings → Roles**. Adding a
capability to `src/lib/permissions.ts` and re-running `npm run db:bootstrap` is
the whole workflow for extending the catalogue.

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
| `npm run db:bootstrap` | Install roles, permissions, and default settings |
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
- **Moving-average cost is company-wide.** `Product.costPrice` is a single
  figure weighted across all warehouses, not a per-location cost.
- **Password reset is not implemented.** An administrator creates accounts with
  a starting password at Settings → Users. Adding Better Auth's email flow is
  the natural next step.
- **Alerts are raised on page load**, not by a scheduler. Opening the dashboard
  or the purchases list refreshes late-delivery detection. A cron job hitting
  those paths would make it fully autonomous.
