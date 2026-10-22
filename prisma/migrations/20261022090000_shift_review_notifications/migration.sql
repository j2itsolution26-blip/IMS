-- CreateEnum
CREATE TYPE "ShiftReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'REVIEWED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SHIFT_OPENED', 'SHIFT_CLOSED', 'SHIFT_SHORTAGE', 'SHIFT_OVERAGE', 'SHIFT_OVERDUE');

-- AlterEnum (PostgreSQL 12+ allows several ADD VALUEs in one transaction as
-- long as nothing below uses them; nothing does.)
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_OPEN';
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_CLOSE';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_MOVEMENT';
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_REVIEW';
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_ADJUSTMENT';

-- AlterTable
ALTER TABLE "cashier_shifts" ADD COLUMN     "number" SERIAL NOT NULL,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStatus" "ShiftReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- Hand-written: SERIAL numbers existing rows in storage order. Renumber them
-- in the order they were opened, so SH-000001 is the store's first shift,
-- and move the sequence past the last one.
UPDATE "cashier_shifts" AS c
SET "number" = o.rn
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "openedAt", "id") AS rn FROM "cashier_shifts") AS o
WHERE c."id" = o."id";

SELECT setval(
  pg_get_serial_sequence('"cashier_shifts"', 'number'),
  COALESCE((SELECT MAX("number") FROM "cashier_shifts"), 0) + 1,
  false
);

-- CreateTable
CREATE TABLE "shift_adjustments" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "shiftId" TEXT,
    "readAt" TIMESTAMP(3),
    "readById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_adjustments_shiftId_idx" ON "shift_adjustments"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_readAt_createdAt_idx" ON "notifications"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_shifts_number_key" ON "cashier_shifts"("number");

-- CreateIndex
CREATE INDEX "cashier_shifts_closedAt_idx" ON "cashier_shifts"("closedAt");

-- CreateIndex
CREATE INDEX "cashier_shifts_reviewStatus_idx" ON "cashier_shifts"("reviewStatus");

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_adjustments" ADD CONSTRAINT "shift_adjustments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_adjustments" ADD CONSTRAINT "shift_adjustments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_readById_fkey" FOREIGN KEY ("readById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written below: what Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- Backfill: shifts already closed short or over wait for the owner's review.
-- The default tolerance is ₱0, so any non-zero variance counts. No figure is
-- changed.
UPDATE "cashier_shifts"
SET "reviewStatus" = 'PENDING'
WHERE "status" = 'CLOSED' AND "difference" IS NOT NULL AND "difference" <> 0;

-- Money and review rules the application also checks.
ALTER TABLE "shift_adjustments"
  ADD CONSTRAINT "shift_adjustments_amount_non_zero" CHECK ("amount" <> 0);
ALTER TABLE "cashier_shifts"
  ADD CONSTRAINT "cashier_shifts_reviewed_has_time" CHECK ("reviewStatus" <> 'REVIEWED' OR "reviewedAt" IS NOT NULL);

-- Append-only records. Updates and deletes are refused for everyone, the
-- application included; a mistake is corrected with a new row.
CREATE FUNCTION "refuse_change_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only and cannot be %d', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_movements_append_only"
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change_append_only"();

CREATE TRIGGER "shift_adjustments_append_only"
  BEFORE UPDATE OR DELETE ON "shift_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change_append_only"();

-- The audit trail: no deletes, and no edits except the user link going NULL
-- when a user row is removed (the foreign key's ON DELETE SET NULL).
CREATE FUNCTION "audit_logs_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."userId" IS NOT NULL AND NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'audit_logs rows cannot be edited' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."action", NEW."entity", NEW."entityId", NEW."summary", NEW."changes"::text,
      NEW."ipAddress", NEW."userAgent", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."action", OLD."entity", OLD."entityId", OLD."summary", OLD."changes"::text,
      OLD."ipAddress", OLD."userAgent", OLD."createdAt") THEN
    RAISE EXCEPTION 'audit_logs rows cannot be edited' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_guard"();

-- A closed shift's reconciliation is final. Its counts, totals and notes
-- cannot change and it cannot be deleted or reopened. Only the review
-- columns may move, once, from PENDING/NOT_REQUIRED to REVIEWED; user links
-- may go NULL through their foreign keys.
CREATE FUNCTION "cashier_shifts_closed_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'CLOSED' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A closed shift cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."status", NEW."userId", NEW."number", NEW."openedAt", NEW."openingCash", NEW."openingNotes",
      NEW."closedAt", NEW."expectedCash", NEW."actualCash", NEW."difference", NEW."totalSales",
      NEW."transactionCount", NEW."cashSales", NEW."cashRefunds", NEW."cashIn", NEW."cashOut", NEW."notes")
     IS DISTINCT FROM
     (OLD."status", OLD."userId", OLD."number", OLD."openedAt", OLD."openingCash", OLD."openingNotes",
      OLD."closedAt", OLD."expectedCash", OLD."actualCash", OLD."difference", OLD."totalSales",
      OLD."transactionCount", OLD."cashSales", OLD."cashRefunds", OLD."cashIn", OLD."cashOut", OLD."notes") THEN
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

CREATE TRIGGER "cashier_shifts_closed_guard"
  BEFORE UPDATE OR DELETE ON "cashier_shifts"
  FOR EACH ROW EXECUTE FUNCTION "cashier_shifts_closed_guard"();

-- ---------------------------------------------------------------------------
-- Rollback (manual; run only to undo this migration):
--
--   DROP TRIGGER IF EXISTS "cashier_shifts_closed_guard" ON "cashier_shifts";
--   DROP FUNCTION IF EXISTS "cashier_shifts_closed_guard"();
--   DROP TRIGGER IF EXISTS "audit_logs_append_only" ON "audit_logs";
--   DROP FUNCTION IF EXISTS "audit_logs_guard"();
--   DROP TRIGGER IF EXISTS "shift_adjustments_append_only" ON "shift_adjustments";
--   DROP TRIGGER IF EXISTS "cash_movements_append_only" ON "cash_movements";
--   DROP FUNCTION IF EXISTS "refuse_change_append_only"();
--   DROP TABLE IF EXISTS "notifications";
--   DROP TABLE IF EXISTS "shift_adjustments";
--   ALTER TABLE "cashier_shifts" DROP CONSTRAINT IF EXISTS "cashier_shifts_reviewed_has_time";
--   ALTER TABLE "cashier_shifts" DROP CONSTRAINT IF EXISTS "cashier_shifts_reviewedById_fkey";
--   DROP INDEX IF EXISTS "cashier_shifts_number_key";
--   DROP INDEX IF EXISTS "cashier_shifts_closedAt_idx";
--   DROP INDEX IF EXISTS "cashier_shifts_reviewStatus_idx";
--   ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "number", DROP COLUMN IF EXISTS "reviewNote",
--     DROP COLUMN IF EXISTS "reviewStatus", DROP COLUMN IF EXISTS "reviewedAt", DROP COLUMN IF EXISTS "reviewedById";
--   DROP TYPE IF EXISTS "NotificationType";
--   DROP TYPE IF EXISTS "ShiftReviewStatus";
--   -- AuditAction values cannot be dropped in PostgreSQL; they are harmless if left.
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261022090000_shift_review_notifications';
-- ---------------------------------------------------------------------------
