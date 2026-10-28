-- Demonstration stores.
--
--   1. stores."isDemo": set only when the System Administrator creates a demo
--      store, and fixed for ever after (trigger). A real store can never be
--      turned into a demo store, so its data can never be reset.
--   2. A demo store's sample data can be reset. Four guards that normally
--      refuse deletes (cash movements, shift adjustments, closed shifts,
--      GCash entries) now let a delete through only when ALL of these hold:
--        * the row belongs to a store whose "isDemo" is true, and
--        * the transaction has set app.demo_reset_store to that very store's
--          id (done only by the platform's reset service, transaction-local).
--      Everything else about those guards is unchanged, for every store.
--      Audit logs, billing records and support tickets are never deleted.
--
-- Every existing store becomes isDemo = false. No row is changed or deleted.
--
-- Rollback (in this order):
--   re-run the guard functions from migrations 20261022090000 (refuse_change_append_only,
--   cashier_shifts_closed_guard, with walletCash from 20261107090000) and 20261107090000
--   (wallet_transactions_guard);
--   DROP TRIGGER IF EXISTS "stores_demo_flag_fixed" ON "stores";
--   DROP FUNCTION IF EXISTS "stores_demo_flag_fixed"();
--   DROP FUNCTION IF EXISTS "demo_reset_allowed"(text);
--   ALTER TABLE "stores" DROP COLUMN IF EXISTS "isDemo";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261108090000_demo_stores';

-- 1. The flag ---------------------------------------------------------------------

ALTER TABLE "stores" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "stores_isDemo_idx" ON "stores"("isDemo");

CREATE OR REPLACE FUNCTION "stores_demo_flag_fixed"() RETURNS trigger AS $$
BEGIN
  IF NEW."isDemo" IS DISTINCT FROM OLD."isDemo" THEN
    RAISE EXCEPTION 'A store cannot be switched between real and demo' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stores_demo_flag_fixed"
  BEFORE UPDATE OF "isDemo" ON "stores"
  FOR EACH ROW EXECUTE FUNCTION "stores_demo_flag_fixed"();

-- 2. The reset exception -------------------------------------------------------------

CREATE OR REPLACE FUNCTION "demo_reset_allowed"(store_id text) RETURNS boolean AS $$
  SELECT store_id IS NOT NULL
     AND current_setting('app.demo_reset_store', true) = store_id
     AND EXISTS (SELECT 1 FROM "stores" WHERE "id" = store_id AND "isDemo");
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION "refuse_change_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND "demo_reset_allowed"(OLD."storeId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are append-only and cannot be %d', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "wallet_transactions_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "demo_reset_allowed"(OLD."storeId") THEN
      RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION "cashier_shifts_closed_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'CLOSED' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "demo_reset_allowed"(OLD."storeId") THEN
      RETURN OLD;
    END IF;
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
