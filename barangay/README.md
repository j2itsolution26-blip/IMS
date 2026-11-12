# Barangay System

A management system for one barangay hall: resident registry (RBI),
certificates with QR verification, official receipts, blotter and
Katarungang Pambarangay cases, a dashboard for the Punong Barangay, staff
accounts with roles, and an audit log.

It is a separate app from the Sari-Sari POS in the repository root. It
shares the same stack (Next.js 15, React 19, TypeScript, Prisma,
PostgreSQL, Tailwind) but has its own database, dependencies and
deployment.

## What it does

| Module | What staff can do |
|---|---|
| **Residents (RBI)** | Add, search and edit residents and households by purok. Track voters, PWD, 4Ps, solo parents and indigents. Seniors (60+) are counted from the birth date. |
| **Certificates** | Find a resident, choose a document, print in about a minute. Each certificate gets a control number (`BC-2026-000001`) and a QR code that opens a public page showing *Valid*, *Expired* or *Revoked*. The public page hides most of the name. |
| **Official receipts** | Certificate fees are recorded with the OR number from the booklet as the certificate is issued. Other collections are recorded separately. OR numbers cannot repeat. Cancelling a receipt needs a reason. |
| **Blotter & KP** | Record blotter entries and KP disputes (`KP-2026-0001`), schedule mediation, conciliation and arbitration hearings, and close a case with its settlement. Every time someone opens a case file, it is logged. |
| **Dashboard** | Today's certificates and collections, open cases, upcoming hearings, population by sector and by purok. |
| **Reports** | Collections by day and by type, and certificates by document, for any period up to a year. CSV export opens in Excel. |
| **Accounts & audit** | One account per person, with roles. Sign-ins, failed sign-ins, changes, prints and exports all go to an audit log that can't be edited from the app. |

### Roles

| | Captain | Secretary | Treasurer | Kagawad | Lupon | Staff |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View residents | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Add/edit residents | ✓ | ✓ | | | | ✓ |
| Issue certificates | ✓ | ✓ | | | | ✓ |
| Revoke certificates | ✓ | ✓ | | | | |
| View receipts | ✓ | ✓ | ✓ | ✓ | | |
| Record receipts | ✓ | ✓ | ✓ | | | |
| Cancel receipts | ✓ | | ✓ | | | |
| View cases | ✓ | ✓ | | ✓ | ✓ | |
| Manage cases | ✓ | ✓ | | | ✓ | |
| Reports | ✓ | ✓ | ✓ | ✓ | | |
| Accounts, settings, audit log | ✓ | | | | | |

The matrix lives in `src/lib/permissions.ts`.

## Run it locally

Requirements: Node 20+ and PostgreSQL 14+.

```bash
cd barangay
cp .env.example .env        # then edit DATABASE_URL and SETUP_TOKEN
npm install
npm run db:deploy           # creates the tables
npm run dev                 # http://localhost:3100
```

Open the app. On a fresh database it goes to **/setup**. Enter the
`SETUP_TOKEN`, the barangay's details, its puroks, and the Punong
Barangay's login. Then sign in and add staff accounts under **Accounts**.
Set document fees to match your revenue ordinance under **Settings**.

## Deploy (Vercel)

1. Create a **new** Vercel project from this repository and set its
   **Root Directory** to `barangay`. The existing POS project is not
   affected.
2. Set the environment variables `DATABASE_URL`, `SETUP_TOKEN` and
   `APP_URL` (the public URL, which is printed inside the QR codes).
3. Run `npm run db:deploy` against the production database once.
4. Open `/setup`, finish setup, then **remove `SETUP_TOKEN`** from Vercel.

## Data privacy (RA 10173)

- Never put real resident records in a development, demo or test
  database. Demos should use invented names.
- Passwords are stored as scrypt hashes. Sessions are random tokens stored
  only as SHA-256 hashes, in httpOnly cookies, and they expire after 7 days.
  After 5 failed sign-ins in 15 minutes, that username is locked for 15
  minutes.
- Every page and server action checks the role against the database.
- The public verification page shows only the document type, a masked
  name, the control number and the dates.
- Back up the database daily (Supabase and Neon both offer this), and
  limit who has database access.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Not in version 1

Offline mode, SMS announcements, online requests with GCash payment,
uploading the barangay seal and logo, and a BHW health log.
