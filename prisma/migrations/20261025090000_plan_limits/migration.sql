-- Subscription plan quotas (multi-store SaaS, step 2).
--
--   1. Adds "productLimit" and "staffLimit" to stores: the plan's quotas,
--      copied from src/lib/plans.ts (empty = unlimited). The app rewrites them
--      whenever a store's plan or status changes (syncStoreLimits).
--   2. Backfills them for existing stores from the same numbers.
--   3. Adds store_usage, the per-month counters for metered features
--      (background removals).
--   4. Adds "enforce_store_quota", which refuses a product or an active staff
--      account over the limit. It locks the store's row first, so concurrent
--      inserts for one store take turns and cannot both pass the count.
--
-- Nothing is deleted or changed in existing rows: a store already over a
-- lower limit keeps everything, it just cannot add more.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS "users_store_quota" ON "users";
--   DROP TRIGGER IF EXISTS "products_store_quota" ON "products";
--   DROP FUNCTION IF EXISTS "enforce_store_quota"();
--   DROP TABLE IF EXISTS "store_usage";
--   ALTER TABLE "stores" DROP COLUMN IF EXISTS "productLimit", DROP COLUMN IF EXISTS "staffLimit";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261025090000_plan_limits';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "productLimit" INTEGER,
ADD COLUMN     "staffLimit" INTEGER;

ALTER TABLE "stores" ADD CONSTRAINT "stores_limits_non_negative"
  CHECK (("productLimit" IS NULL OR "productLimit" >= 0) AND ("staffLimit" IS NULL OR "staffLimit" >= 0));

-- Backfill. Must match PLANS in src/lib/plans.ts (tests/plans.test.ts checks):
-- a trial gets the Business plan's quotas unless it bought a higher plan.
UPDATE "stores" SET
  "productLimit" = CASE
    WHEN "plan" = 'ENTERPRISE' THEN NULL
    WHEN "plan" = 'BUSINESS' OR "status" = 'TRIAL' THEN 5000
    ELSE 500 END,
  "staffLimit" = CASE
    WHEN "plan" = 'ENTERPRISE' THEN NULL
    WHEN "plan" = 'BUSINESS' OR "status" = 'TRIAL' THEN 15
    ELSE 3 END;

-- CreateTable
CREATE TABLE "store_usage" (
    "storeId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_usage_pkey" PRIMARY KEY ("storeId","metric","period"),
    CONSTRAINT "store_usage_count_non_negative" CHECK ("count" >= 0)
);

-- AddForeignKey
ALTER TABLE "store_usage" ADD CONSTRAINT "store_usage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quota trigger. The message starts with PLAN_LIMIT so the app can show a
-- plan message instead of a database error.
CREATE OR REPLACE FUNCTION "enforce_store_quota"() RETURNS trigger AS $$
DECLARE
  quota integer;
  owner_id text;
  used integer;
BEGIN
  IF NEW."storeId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'products' THEN
    -- Only a row that starts counting: a new non-archived product, or one
    -- brought back from the archive.
    IF NEW."status" = 'ARCHIVED' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD."status" <> 'ARCHIVED' AND OLD."storeId" = NEW."storeId" THEN RETURN NEW; END IF;

    SELECT "productLimit" INTO quota FROM "stores" WHERE "id" = NEW."storeId" FOR UPDATE;
    IF quota IS NULL THEN RETURN NEW; END IF;
    SELECT count(*) INTO used FROM "products"
      WHERE "storeId" = NEW."storeId" AND "status" <> 'ARCHIVED' AND "id" <> NEW."id";
    IF used >= quota THEN
      RAISE EXCEPTION 'PLAN_LIMIT: products %', quota USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- users: a new active account, or one reactivated or moved into the store.
  IF NOT NEW."isActive" THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD."isActive" AND OLD."storeId" IS NOT DISTINCT FROM NEW."storeId" THEN RETURN NEW; END IF;

  SELECT "staffLimit", "ownerId" INTO quota, owner_id FROM "stores" WHERE "id" = NEW."storeId" FOR UPDATE;
  -- The owner never counts against the staff quota.
  IF quota IS NULL OR NEW."id" = owner_id THEN RETURN NEW; END IF;
  SELECT count(*) INTO used FROM "users"
    WHERE "storeId" = NEW."storeId" AND "isActive" AND "id" <> NEW."id"
      AND "id" IS DISTINCT FROM owner_id;
  IF used >= quota THEN
    RAISE EXCEPTION 'PLAN_LIMIT: staff %', quota USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_store_quota"
  BEFORE INSERT OR UPDATE OF "status", "storeId" ON "products"
  FOR EACH ROW EXECUTE FUNCTION "enforce_store_quota"();

CREATE TRIGGER "users_store_quota"
  BEFORE INSERT OR UPDATE OF "isActive", "storeId" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "enforce_store_quota"();
