-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- AlterTable
ALTER TABLE "cashier_shifts" ADD COLUMN     "cashIn" DECIMAL(18,4),
ADD COLUMN     "cashOut" DECIMAL(18,4),
ADD COLUMN     "cashRefunds" DECIMAL(18,4),
ADD COLUMN     "cashSales" DECIMAL(18,4),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "openingNotes" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "shiftId" TEXT;

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_movements_shiftId_idx" ON "cash_movements"("shiftId");

-- CreateIndex
CREATE INDEX "payments_shiftId_idx" ON "payments"("shiftId");

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written below: what Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- Backfill: attribute every existing payment to the drawer the current shift
-- maths already counts it against — a sale's payments to the sale's shift, a
-- refund to the shift of the sale it refunds. Totals of open shifts therefore
-- read the same before and after this migration (apart from voided sales,
-- which the application now excludes). No row is deleted or re-priced.
UPDATE "payments" AS p
SET "shiftId" = s."shiftId"
FROM "sales" AS s
WHERE p."saleId" = s."id" AND s."shiftId" IS NOT NULL AND p."shiftId" IS NULL;

UPDATE "payments" AS p
SET "shiftId" = s."shiftId"
FROM "returns" AS r
JOIN "sales" AS s ON s."id" = r."saleId"
WHERE p."returnId" = r."id" AND s."shiftId" IS NOT NULL AND p."shiftId" IS NULL;

-- One OPEN shift per cashier, enforced by the database so two simultaneous
-- "open shift" requests cannot both succeed. Fails (and the whole migration
-- rolls back) if a cashier already has two open shifts — close the extra one
-- first; see the deployment notes.
CREATE UNIQUE INDEX "cashier_shifts_one_open_per_user"
ON "cashier_shifts" ("userId")
WHERE "status" = 'OPEN';

-- Money rules the application also checks. NOT VALID: enforced for every new
-- or changed row without re-checking history.
ALTER TABLE "cashier_shifts"
  ADD CONSTRAINT "cashier_shifts_opening_cash_non_negative" CHECK ("openingCash" >= 0) NOT VALID;
ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_amount_positive" CHECK ("amount" > 0);

-- ---------------------------------------------------------------------------
-- Rollback (manual; run only to undo this migration):
--
--   DROP INDEX IF EXISTS "cashier_shifts_one_open_per_user";
--   ALTER TABLE "cashier_shifts" DROP CONSTRAINT IF EXISTS "cashier_shifts_opening_cash_non_negative";
--   ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_shiftId_fkey";
--   DROP INDEX IF EXISTS "payments_shiftId_idx";
--   ALTER TABLE "payments" DROP COLUMN IF EXISTS "shiftId";
--   DROP TABLE IF EXISTS "cash_movements";
--   DROP TYPE IF EXISTS "CashMovementType";
--   ALTER TABLE "cashier_shifts" DROP CONSTRAINT IF EXISTS "cashier_shifts_closedById_fkey";
--   ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "cashIn", DROP COLUMN IF EXISTS "cashOut",
--     DROP COLUMN IF EXISTS "cashRefunds", DROP COLUMN IF EXISTS "cashSales",
--     DROP COLUMN IF EXISTS "closedById", DROP COLUMN IF EXISTS "openingNotes";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021090000_shift_cash_management';
-- ---------------------------------------------------------------------------
