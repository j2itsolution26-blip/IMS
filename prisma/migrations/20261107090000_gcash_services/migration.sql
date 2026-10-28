-- GCash cash-in / cash-out services.
--
--   1. wallet_transactions: one row per customer cash-in or cash-out, tied
--      to the cashier's open shift. Not a sale; only the fee is revenue.
--        CASH_IN   drawer + amount + fee, store GCash - amount
--        CASH_OUT  drawer - amount + fee, store GCash + amount
--      Rules held by the database:
--        * amount > 0; 0 <= fee < amount for a cash-out, fee >= 0 for a cash-in;
--        * one live (not reversed) entry per GCash reference per store;
--        * one entry per checkout attempt (clientRequestId);
--        * append-only: only a single reversal (time, who, reason) may be
--          added, and it is final; no deletes;
--        * the shift, cashier and reverser belong to the same store.
--   2. cashier_shifts."walletCash": the shift's net drawer cash from these
--      services, frozen at close, and covered by the closed-shift guard.
--
-- Nothing existing is changed; shifts closed before this keep walletCash empty.
--
-- Rollback (in this order):
--   DROP TABLE IF EXISTS "wallet_transactions";
--   DROP FUNCTION IF EXISTS "wallet_transactions_guard"();
--   DROP TYPE IF EXISTS "WalletTransactionType";
--   re-run CREATE OR REPLACE FUNCTION "cashier_shifts_closed_guard" from migration 20261022090000;
--   ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "walletCash";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261107090000_gcash_services';

-- 1. Wallet transactions -------------------------------------------------------

CREATE TYPE "WalletTransactionType" AS ENUM ('CASH_IN', 'CASH_OUT');

CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'GCASH',
    "amount" DECIMAL(18,4) NOT NULL,
    "fee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL,
    "customerMobileLast4" TEXT,
    "notes" TEXT,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_transactions_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "wallet_transactions_fee_valid" CHECK ("fee" >= 0 AND ("type" = 'CASH_IN' OR "fee" < "amount")),
    CONSTRAINT "wallet_transactions_reference_present" CHECK (length(btrim("reference")) >= 6),
    CONSTRAINT "wallet_transactions_mobile_last4" CHECK ("customerMobileLast4" IS NULL OR "customerMobileLast4" ~ '^[0-9]{4}$'),
    CONSTRAINT "wallet_transactions_reversal_fields" CHECK (
      ("reversedAt" IS NULL AND "reversedById" IS NULL AND "reversalReason" IS NULL)
      OR ("reversedAt" IS NOT NULL AND "reversalReason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "wallet_transactions_number_key" ON "wallet_transactions"("number");
CREATE UNIQUE INDEX "wallet_transactions_storeId_clientRequestId_key" ON "wallet_transactions"("storeId", "clientRequestId");
-- The same GCash transfer can be recorded only once while it stands.
CREATE UNIQUE INDEX "wallet_transactions_live_reference" ON "wallet_transactions"("storeId", "channel", "reference") WHERE "reversedAt" IS NULL;
CREATE INDEX "wallet_transactions_storeId_createdAt_idx" ON "wallet_transactions"("storeId", "createdAt");
CREATE INDEX "wallet_transactions_shiftId_idx" ON "wallet_transactions"("shiftId");
CREATE INDEX "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Store isolation, as for every store-owned table.
CREATE TRIGGER "wallet_transactions_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "shiftId", "userId", "reversedById" ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('shiftId', 'cashier_shifts', 'userId', 'users', 'reversedById', 'users');

-- Append-only, except one reversal.
CREATE OR REPLACE FUNCTION "wallet_transactions_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'wallet_transactions rows are append-only and cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."reversedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'wallet_transactions rows are append-only: this entry is already reversed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."storeId", NEW."number", NEW."type", NEW."channel", NEW."amount", NEW."fee", NEW."reference",
      NEW."customerMobileLast4", NEW."notes", NEW."shiftId", NEW."userId", NEW."clientRequestId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."storeId", OLD."number", OLD."type", OLD."channel", OLD."amount", OLD."fee", OLD."reference",
      OLD."customerMobileLast4", OLD."notes", OLD."shiftId", OLD."userId", OLD."clientRequestId", OLD."createdAt") THEN
    RAISE EXCEPTION 'wallet_transactions rows are append-only: only a reversal may be added' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallet_transactions_guard"
  BEFORE UPDATE OR DELETE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION "wallet_transactions_guard"();

-- 2. Shift figure, frozen at close ---------------------------------------------------

ALTER TABLE "cashier_shifts" ADD COLUMN "walletCash" DECIMAL(18,4);

CREATE OR REPLACE FUNCTION "cashier_shifts_closed_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'CLOSED' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A closed shift cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."status", NEW."userId", NEW."number", NEW."openedAt", NEW."openingCash", NEW."openingNotes",
      NEW."closedAt", NEW."expectedCash", NEW."actualCash", NEW."difference", NEW."totalSales",
      NEW."transactionCount", NEW."cashSales", NEW."cashRefunds", NEW."cashIn", NEW."cashOut", NEW."walletCash", NEW."notes")
     IS DISTINCT FROM
     (OLD."status", OLD."userId", OLD."number", OLD."openedAt", OLD."openingCash", OLD."openingNotes",
      OLD."closedAt", OLD."expectedCash", OLD."actualCash", OLD."difference", OLD."totalSales",
      OLD."transactionCount", OLD."cashSales", OLD."cashRefunds", OLD."cashIn", OLD."cashOut", OLD."walletCash", OLD."notes") THEN
    RAISE EXCEPTION 'A closed shift''s figures cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."closedById" IS NOT NULL AND NEW."closedById" IS DISTINCT FROM OLD."closedById" THEN
    RAISE EXCEPTION 'A closed shift''s figures cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."reviewStatus" = 'REVIEWED' AND (
       NEW."reviewStatus" IS DISTINCT FROM OLD."reviewStatus"
       OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
       OR NEW."reviewNote" IS DISTINCT FROM OLD."reviewNote"
       OR (NEW."reviewedById" IS NOT NULL AND NEW."reviewedById" IS DISTINCT FROM OLD."reviewedById")) THEN
    RAISE EXCEPTION 'A completed review cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
