-- Subscription billing: prices, terms, invoices and verified payments.
--
--   1. plan_prices: what each plan costs per interval. Empty until the
--      platform administrator enters prices; no price is assumed.
--   2. billing_terms: append-only versions of the terms an owner accepts.
--   3. platform_settings: platform-wide values (payment instructions).
--   4. invoices: an obligation an owner agreed to by choosing a plan and
--      accepting the terms. Amount, plan, period and terms are copied and
--      frozen; status moves once, OPEN -> PAID or OPEN -> VOID. At most one
--      OPEN invoice per store.
--   5. subscription_payments gains a status. Every existing row was recorded
--      by the administrator as money received, so it becomes VERIFIED.
--      Owner-submitted payments start PENDING and move once, to VERIFIED or
--      REJECTED, by the administrator.
--   6. platform_notifications: notifications for the administrator.
--   7. billing.manage permission (choose a plan, submit a payment reference),
--      granted to every store's Owner role, as billing.view was.
--
-- Additive: no existing row loses data; existing payments keep every value.
--
-- Rollback (in this order):
--   DELETE FROM "role_permissions" WHERE "permissionId" = 'perm_billing_manage';
--   DELETE FROM "permissions" WHERE "id" = 'perm_billing_manage';
--   DROP TRIGGER IF EXISTS "invoices_permanent" ON "invoices";
--   DROP FUNCTION IF EXISTS "invoices_permanent"();
--   (restore "subscription_payments_permanent"() from migration 20261026090000)
--   ALTER TABLE "subscription_payments" DROP COLUMN "invoiceId", DROP COLUMN "status",
--     DROP COLUMN "verifiedAt", DROP COLUMN "verifiedById", DROP COLUMN "rejectedAt",
--     DROP COLUMN "rejectedById", DROP COLUMN "rejectReason";
--   ALTER TABLE "stores" DROP COLUMN "billingInterval";
--   DROP TABLE "platform_notifications", "invoices", "platform_settings", "billing_terms", "plan_prices";
--   DROP TYPE "InvoiceStatus", "BillingInterval", "SubscriptionPaymentStatus";
--   (added NotificationType values cannot be removed; they go unused after a rollback)

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- AlterEnum (the new values are not used in this migration)
ALTER TYPE "NotificationType" ADD VALUE 'BILLING_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'INVOICE_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_VERIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REJECTED';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "billingInterval" "BillingInterval";

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" TEXT NOT NULL,
    "plan" "StorePlan" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_terms" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "plan" "StorePlan" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" INTEGER NOT NULL,
    "termsBody" TEXT NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_notifications" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "storeId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "readById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_plan_interval_key" ON "plan_prices"("plan", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "billing_terms_version_key" ON "billing_terms"("version");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_storeId_createdAt_idx" ON "invoices"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_status_dueAt_idx" ON "invoices"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_notifications_dedupeKey_key" ON "platform_notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "platform_notifications_readAt_createdAt_idx" ON "platform_notifications"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_payments_status_idx" ON "subscription_payments"("status");

-- CreateIndex
CREATE INDEX "subscription_payments_invoiceId_idx" ON "subscription_payments"("invoiceId");

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing payments were recorded as received by the administrator: say who
-- verified them and when, so every VERIFIED row carries that. Runs before the
-- trigger below is replaced, under the old rules, which do not compare these
-- new columns.
UPDATE "subscription_payments"
SET "verifiedAt" = "createdAt", "verifiedById" = "recordedById"
WHERE "status" = 'VERIFIED' AND "verifiedAt" IS NULL AND "voidedAt" IS NULL;

-- One OPEN invoice per store: two clicks or two tabs cannot create two
-- obligations for the same store.
CREATE UNIQUE INDEX "invoices_one_open_per_store" ON "invoices"("storeId") WHERE "status" = 'OPEN';

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_order" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_amount_positive" CHECK ("amount" > 0);

-- Invoices are permanent: nothing but the status moves, and only once.
CREATE OR REPLACE FUNCTION "invoices_permanent"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices cannot be deleted; void them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."number", NEW."storeId", NEW."plan", NEW."interval", NEW."amount", NEW."currency",
      NEW."periodStart", NEW."periodEnd", NEW."dueAt", NEW."termsVersion", NEW."termsBody",
      NEW."acceptedById", NEW."acceptedAt", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."number", OLD."storeId", OLD."plan", OLD."interval", OLD."amount", OLD."currency",
      OLD."periodStart", OLD."periodEnd", OLD."dueAt", OLD."termsVersion", OLD."termsBody",
      OLD."acceptedById", OLD."acceptedAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'invoices cannot be edited; void and issue a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'OPEN'
     AND (NEW."status", NEW."paidAt", NEW."voidedAt", NEW."voidedById", NEW."voidReason")
         IS DISTINCT FROM (OLD."status", OLD."paidAt", OLD."voidedAt", OLD."voidedById", OLD."voidReason") THEN
    RAISE EXCEPTION 'this invoice is already closed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'PAID' AND NEW."paidAt" IS NULL THEN
    RAISE EXCEPTION 'a paid invoice needs a paid date' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'VOID' AND (NEW."voidedAt" IS NULL OR NEW."voidReason" IS NULL) THEN
    RAISE EXCEPTION 'a void invoice needs a date and a reason' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoices_permanent"
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_permanent"();

-- Payments stay permanent (migration 20261026090000), and now also: the
-- invoice link never changes, and the review moves once, PENDING to VERIFIED
-- or REJECTED, after which it is frozen. Only verified money can be voided.
CREATE OR REPLACE FUNCTION "subscription_payments_permanent"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription payments cannot be deleted; void them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'this subscription payment is already void'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."storeId", NEW."plan", NEW."amount", NEW."currency", NEW."method", NEW."reference",
      NEW."paidAt", NEW."months", NEW."periodStart", NEW."periodEnd", NEW."notes", NEW."recordedById",
      NEW."createdAt", NEW."invoiceId")
     IS DISTINCT FROM
     (OLD."id", OLD."storeId", OLD."plan", OLD."amount", OLD."currency", OLD."method", OLD."reference",
      OLD."paidAt", OLD."months", OLD."periodStart", OLD."periodEnd", OLD."notes", OLD."recordedById",
      OLD."createdAt", OLD."invoiceId") THEN
    RAISE EXCEPTION 'subscription payments cannot be edited; void and record again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'PENDING'
     AND (NEW."status", NEW."verifiedAt", NEW."verifiedById", NEW."rejectedAt", NEW."rejectedById", NEW."rejectReason")
         IS DISTINCT FROM (OLD."status", OLD."verifiedAt", OLD."verifiedById", OLD."rejectedAt", OLD."rejectedById", OLD."rejectReason") THEN
    RAISE EXCEPTION 'this payment has already been reviewed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'VERIFIED' AND (NEW."verifiedAt" IS NULL OR NEW."verifiedById" IS NULL) THEN
    RAISE EXCEPTION 'a verified payment needs who verified it and when' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'REJECTED' AND (NEW."rejectedAt" IS NULL OR NEW."rejectedById" IS NULL OR NEW."rejectReason" IS NULL) THEN
    RAISE EXCEPTION 'a rejected payment needs who rejected it, when and why' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."voidedAt" IS NOT NULL AND NEW."status" <> 'VERIFIED' THEN
    RAISE EXCEPTION 'only a verified payment can be voided' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- billing.manage: choose a paid plan and submit payment references for the
-- owner's own store. Owners hold every store permission, so every store's
-- Owner role gets it; no other role does until an owner grants it.
INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES ('perm_billing_manage', 'billing.manage', 'billing', 'manage', 'Manage — Subscription plan, usage and payments')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'billing.manage'
WHERE r."slug" = 'owner' AND r."storeId" IS NOT NULL
ON CONFLICT DO NOTHING;
