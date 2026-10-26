-- Proof of payment for owner-submitted subscription payments.
--
--   1. subscription_payment_receipts: one receipt image per payment, in a
--      private bucket. Append-only; always the payment's own store, uploaded
--      by one of that store's accounts (tenant_guard). A correction is a new
--      payment with a new receipt; the rejected one keeps its evidence.
--   2. Every owner submission (a PENDING payment) must have its receipt by
--      the end of the transaction that creates it (deferred constraint
--      trigger). Payments recorded before this migration, and payments the
--      administrator records directly (VERIFIED from the start), have none.
--   3. A reference is unique per method among payments that were not
--      rejected, instead of among all payments: corrected proof may repeat a
--      reference the administrator rejected (e.g. for an unreadable receipt),
--      while a pending or verified transfer still cannot be reported twice.
--   3b. At most one PENDING submission per invoice (partial unique index), so
--      concurrent submissions cannot both wait for review.
--   4. Verifying a payment may set the period it actually bought, in the same
--      update that moves it from PENDING to VERIFIED and at no other time.
--      A store whose paid time had lapsed is paid from the approval, not
--      from when the invoice was issued.
--   5. NotificationType PAYMENT_SUBMITTED, for the owner's bell.
--
-- Additive: no existing row changes. The new partial index covers every
-- existing row, since the old index already made all references unique.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS "subscription_payments_need_receipt" ON "subscription_payments";
--   DROP FUNCTION IF EXISTS "subscription_payments_need_receipt"();
--   DROP TABLE "subscription_payment_receipts";
--   DROP FUNCTION IF EXISTS "subscription_payment_receipts_append_only"();
--   DROP INDEX "subscription_payments_one_pending_per_invoice";
--   DROP INDEX "subscription_payments_reference_unless_rejected";
--   CREATE UNIQUE INDEX "subscription_payments_method_reference_key" ON "subscription_payments"("method", "reference");
--     (fails if a rejected reference was reused meanwhile; resolve those rows first)
--   (restore "subscription_payments_permanent"() from migration 20261029090000)
--   (the added NotificationType value cannot be removed; it goes unused after a rollback)

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_SUBMITTED';

-- Reference uniqueness, ignoring rejected payments. Created before the old
-- index is dropped, so references are never unguarded.
CREATE UNIQUE INDEX "subscription_payments_reference_unless_rejected"
  ON "subscription_payments"("method", "reference") WHERE "status" <> 'REJECTED';

-- DropIndex
DROP INDEX "subscription_payments_method_reference_key";

-- At most one submission awaiting review per invoice, even under concurrent
-- requests (the service also checks, under the store's row lock).
CREATE UNIQUE INDEX "subscription_payments_one_pending_per_invoice"
  ON "subscription_payments"("invoiceId") WHERE "status" = 'PENDING' AND "invoiceId" IS NOT NULL;

-- CreateTable
CREATE TABLE "subscription_payment_receipts" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payment_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_payment_receipts_type" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT "subscription_payment_receipts_size" CHECK ("sizeBytes" > 0),
    CONSTRAINT "subscription_payment_receipts_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payment_receipts_paymentId_key" ON "subscription_payment_receipts"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payment_receipts_storagePath_key" ON "subscription_payment_receipts"("storagePath");

-- CreateIndex
CREATE INDEX "subscription_payment_receipts_storeId_createdAt_idx" ON "subscription_payment_receipts"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_payment_receipts_sha256_idx" ON "subscription_payment_receipts"("sha256");

-- AddForeignKey
ALTER TABLE "subscription_payment_receipts" ADD CONSTRAINT "subscription_payment_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "subscription_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_receipts" ADD CONSTRAINT "subscription_payment_receipts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_receipts" ADD CONSTRAINT "subscription_payment_receipts_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The receipt is the payment's store's, uploaded by one of its accounts.
CREATE TRIGGER "subscription_payment_receipts_tenant_guard"
  BEFORE INSERT OR UPDATE ON "subscription_payment_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('paymentId', 'subscription_payments', 'uploadedById', 'users');

-- Evidence is never edited or removed.
CREATE OR REPLACE FUNCTION "subscription_payment_receipts_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment receipts cannot be changed or deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subscription_payment_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "subscription_payment_receipts"
  FOR EACH ROW EXECUTE FUNCTION "subscription_payment_receipts_append_only"();

-- An owner submission without its receipt never commits. Deferred to the end
-- of the transaction, which inserts the payment and then its receipt.
CREATE OR REPLACE FUNCTION "subscription_payments_need_receipt"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'PENDING' AND NOT EXISTS (
    SELECT 1 FROM "subscription_payment_receipts" WHERE "paymentId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'a submitted payment needs its receipt'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "subscription_payments_need_receipt"
  AFTER INSERT ON "subscription_payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "subscription_payments_need_receipt"();

-- As in migration 20261029090000, except that the period bought (months is
-- fixed; periodStart and periodEnd) may be set by the update that moves a
-- payment from PENDING to VERIFIED, and only by that update.
CREATE OR REPLACE FUNCTION "subscription_payments_permanent"() RETURNS trigger AS $$
DECLARE
  verifying boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription payments cannot be deleted; void them instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'this subscription payment is already void'
      USING ERRCODE = 'check_violation';
  END IF;
  verifying := OLD."status" = 'PENDING' AND NEW."status" = 'VERIFIED';
  IF (NEW."id", NEW."storeId", NEW."plan", NEW."amount", NEW."currency", NEW."method", NEW."reference",
      NEW."paidAt", NEW."months", NEW."notes", NEW."recordedById", NEW."createdAt", NEW."invoiceId")
     IS DISTINCT FROM
     (OLD."id", OLD."storeId", OLD."plan", OLD."amount", OLD."currency", OLD."method", OLD."reference",
      OLD."paidAt", OLD."months", OLD."notes", OLD."recordedById", OLD."createdAt", OLD."invoiceId")
     OR (NOT verifying AND (NEW."periodStart", NEW."periodEnd") IS DISTINCT FROM (OLD."periodStart", OLD."periodEnd")) THEN
    RAISE EXCEPTION 'subscription payments cannot be edited; void and record again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF verifying AND NEW."periodEnd" <= NEW."periodStart" THEN
    RAISE EXCEPTION 'a payment period must end after it starts' USING ERRCODE = 'check_violation';
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
