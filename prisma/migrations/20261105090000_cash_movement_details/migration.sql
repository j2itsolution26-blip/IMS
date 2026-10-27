-- Traceable cash in / cash out.
--
--   1. cash_movements gets:
--        "number"          a reference shown as CO-000123 / CI-000123, from a
--                          sequence (existing rows are numbered as the table
--                          is rewritten, normally the order they were saved);
--        "category"        why the cash moved (supplier, expense, bank
--                          deposit, …); existing rows become OTHER and keep
--                          their typed reason;
--        "notes"           an optional longer explanation;
--        "correctsId"      a correction points at the movement it reverses,
--                          at most once (unique);
--        "clientRequestId" one per attempt, unique per store, so a doubled
--                          submit records the movement once.
--   2. The tenant guard also checks "correctsId" belongs to the same store.
--      (Movements are already append-only, migration 20261022090000: a
--      mistake is corrected with an opposite, linked movement.)
--
-- No row is deleted, and every existing amount and reason is unchanged.
--
-- Rollback (in this order):
--   ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS "cash_movements_correction_link";
--   DROP TRIGGER IF EXISTS "cash_movements_tenant_guard" ON "cash_movements";
--   CREATE TRIGGER "cash_movements_tenant_guard" BEFORE INSERT OR UPDATE OF "storeId", "shiftId", "userId" ON "cash_movements"
--     FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('shiftId', 'cashier_shifts', 'userId', 'users');
--   ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS "cash_movements_correctsId_fkey";
--   DROP INDEX IF EXISTS "cash_movements_correctsId_key";
--   DROP INDEX IF EXISTS "cash_movements_storeId_clientRequestId_key";
--   DROP INDEX IF EXISTS "cash_movements_number_key";
--   DROP INDEX IF EXISTS "cash_movements_storeId_createdAt_idx";
--   DROP INDEX IF EXISTS "cash_movements_userId_createdAt_idx";
--   ALTER TABLE "cash_movements" DROP COLUMN IF EXISTS "number", DROP COLUMN IF EXISTS "category",
--     DROP COLUMN IF EXISTS "notes", DROP COLUMN IF EXISTS "correctsId", DROP COLUMN IF EXISTS "clientRequestId";
--   DROP TYPE IF EXISTS "CashMovementCategory";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261105090000_cash_movement_details';

-- 1. New columns -----------------------------------------------------------------

CREATE TYPE "CashMovementCategory" AS ENUM (
  'CHANGE_FUND',
  'OWNER_TOP_UP',
  'SUPPLIER_PAYMENT',
  'EXPENSE',
  'BANK_DEPOSIT',
  'OWNER_WITHDRAWAL',
  'CORRECTION',
  'OTHER'
);

ALTER TABLE "cash_movements"
  ADD COLUMN "category" "CashMovementCategory" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "correctsId" TEXT,
  ADD COLUMN "clientRequestId" TEXT;

-- Adding the column with a sequence default numbers every existing row as the
-- table is rewritten. That is not an UPDATE, so the append-only trigger from
-- migration 20261022090000 is not involved and no row's content changes.
CREATE SEQUENCE "cash_movements_number_seq";
ALTER TABLE "cash_movements" ADD COLUMN "number" INTEGER NOT NULL DEFAULT nextval('"cash_movements_number_seq"');
ALTER SEQUENCE "cash_movements_number_seq" OWNED BY "cash_movements"."number";

CREATE UNIQUE INDEX "cash_movements_number_key" ON "cash_movements"("number");
CREATE UNIQUE INDEX "cash_movements_correctsId_key" ON "cash_movements"("correctsId");
CREATE UNIQUE INDEX "cash_movements_storeId_clientRequestId_key" ON "cash_movements"("storeId", "clientRequestId");
CREATE INDEX "cash_movements_storeId_createdAt_idx" ON "cash_movements"("storeId", "createdAt");
CREATE INDEX "cash_movements_userId_createdAt_idx" ON "cash_movements"("userId", "createdAt");

ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_correctsId_fkey"
  FOREIGN KEY ("correctsId") REFERENCES "cash_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A correction is labelled as one, and only a correction points at another movement.
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_correction_link"
  CHECK (("category" = 'CORRECTION') = ("correctsId" IS NOT NULL));

-- 2. Tenant guard covers the corrected movement ----------------------------------

DROP TRIGGER IF EXISTS "cash_movements_tenant_guard" ON "cash_movements";
CREATE TRIGGER "cash_movements_tenant_guard"
  BEFORE INSERT ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('shiftId', 'cashier_shifts', 'userId', 'users', 'correctsId', 'cash_movements');
