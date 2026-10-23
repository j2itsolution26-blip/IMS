-- Subscription management (multi-store SaaS, step 3).
--
--   1. subscription_payments: manual GCash / bank-transfer payments the
--      platform administrator confirmed. One reference per method, ever.
--   2. A trigger that keeps them permanent: no deletes, and the only update
--      allowed is voiding an entry once (with who, when and why).
--   3. Audit actions SUBSCRIPTION and PAYMENT.
--   4. The billing.view permission (Settings → Subscription), granted to every
--      store's Owner role here, so bootstrap does not have to run (it resets
--      the built-in roles' permissions to their defaults).
--
-- No existing row changes: stores keep their plan, status and dates.
--
-- Rollback (in this order):
--   DELETE FROM "role_permissions" WHERE "permissionId" = 'perm_billing_view';
--   DELETE FROM "permissions" WHERE "id" = 'perm_billing_view';
--   DROP TRIGGER IF EXISTS "subscription_payments_permanent" ON "subscription_payments";
--   DROP FUNCTION IF EXISTS "subscription_payments_permanent"();
--   DROP TABLE IF EXISTS "subscription_payments";
--   DROP TYPE IF EXISTS "SubscriptionPaymentMethod";
--   -- The two AuditAction values cannot be dropped in PostgreSQL; unused, they are harmless.
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261026090000_subscriptions';

-- CreateEnum
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('GCASH', 'BANK_TRANSFER', 'OTHER');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT';

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "plan" "StorePlan" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "method" "SubscriptionPaymentMethod" NOT NULL,
    "reference" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "months" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_payments_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "subscription_payments_months_range" CHECK ("months" BETWEEN 1 AND 24),
    CONSTRAINT "subscription_payments_period_order" CHECK ("periodEnd" > "periodStart"),
    CONSTRAINT "subscription_payments_reference_present" CHECK (length("reference") > 0),
    CONSTRAINT "subscription_payments_void_complete" CHECK (
      ("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
      OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND length("voidReason") > 0)
    )
);

-- CreateIndex
CREATE INDEX "subscription_payments_storeId_createdAt_idx" ON "subscription_payments"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_method_reference_key" ON "subscription_payments"("method", "reference");

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payments are a financial record: never deleted, never rewritten. Voiding
-- (once) is the only change, and it may touch nothing but the void columns.
CREATE OR REPLACE FUNCTION "subscription_payments_permanent"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription payments cannot be deleted; void them instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'this subscription payment is already void'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."id", NEW."storeId", NEW."plan", NEW."amount", NEW."currency", NEW."method", NEW."reference",
      NEW."paidAt", NEW."months", NEW."periodStart", NEW."periodEnd", NEW."notes", NEW."recordedById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."storeId", OLD."plan", OLD."amount", OLD."currency", OLD."method", OLD."reference",
      OLD."paidAt", OLD."months", OLD."periodStart", OLD."periodEnd", OLD."notes", OLD."recordedById", OLD."createdAt") THEN
    RAISE EXCEPTION 'subscription payments cannot be edited; void and record again'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subscription_payments_permanent"
  BEFORE UPDATE OR DELETE ON "subscription_payments"
  FOR EACH ROW EXECUTE FUNCTION "subscription_payments_permanent"();

-- billing.view, for Settings → Subscription. Owners hold every store
-- permission ('ALL' in src/lib/permissions.ts), so every store's Owner role
-- gets it; no other role does until an owner grants it.
INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES ('perm_billing_view', 'billing.view', 'billing', 'view', 'View — Subscription plan, usage and payments')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'billing.view'
WHERE r."slug" = 'owner' AND r."storeId" IS NOT NULL
ON CONFLICT DO NOTHING;
