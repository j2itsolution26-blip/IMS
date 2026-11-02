-- Basic plan: three staff, as two Cashiers and one Inventory Staff.
--
--   1. Replaces stores."staffRoleLimit" (one number for every built-in role)
--      with stores."staffRoleLimits", a JSON object of the most active
--      accounts per role slug, copied from PLANS[*].staffSlots in
--      src/lib/plans.ts: Basic {"cashier": 2, "inventory-staff": 1}; empty
--      (no per-role cap) on Business and Enterprise. Basic's staff total
--      ("staffLimit") becomes 3.
--   2. Replaces "enforce_store_quota" so the per-role check reads the role's
--      own number from the JSON. Everything else is unchanged from migration
--      20261111090000: it locks the store's row first, never counts the
--      owner, refuses custom roles for active accounts on a plan with slots,
--      and only checks accounts that start counting.
--
-- Raising limits deletes and switches off nothing.
--
-- Rollback (in this order):
--   ALTER TABLE "stores" ADD COLUMN "staffRoleLimit" INTEGER;
--   UPDATE "stores" SET "staffRoleLimit" = 1, "staffLimit" = 2 WHERE "plan" = 'BASIC';
--   re-run the CREATE FUNCTION "enforce_store_quota" from migration 20261111090000;
--   ALTER TABLE "stores" DROP COLUMN "staffRoleLimits";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114090000_basic_staff_slots';

ALTER TABLE "stores" ADD COLUMN "staffRoleLimits" JSONB;

-- Backfill. Must match PLANS[*] in src/lib/plans.ts (tests/plans.test.ts checks).
UPDATE "stores" SET
  "staffRoleLimits" = CASE WHEN "plan" = 'BASIC' THEN '{"cashier": 2, "inventory-staff": 1}'::jsonb ELSE NULL END,
  "staffLimit" = CASE WHEN "plan" = 'BASIC' THEN 3 ELSE "staffLimit" END;
-- End backfill.

ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_staff_role_limit_non_negative";
ALTER TABLE "stores" DROP COLUMN "staffRoleLimit";

CREATE OR REPLACE FUNCTION "enforce_store_quota"() RETURNS trigger AS $$
DECLARE
  quota integer;
  role_limits jsonb;
  role_quota integer;
  owner_id text;
  role_slug text;
  used integer;
  starts_counting boolean;
BEGIN
  IF NEW."storeId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'products' THEN
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

  -- users. An inactive account takes no seat and no slot.
  IF NOT NEW."isActive" THEN RETURN NEW; END IF;

  starts_counting := NOT (TG_OP = 'UPDATE' AND OLD."isActive" AND OLD."storeId" IS NOT DISTINCT FROM NEW."storeId");
  IF NOT starts_counting AND OLD."roleId" IS NOT DISTINCT FROM NEW."roleId" THEN
    RETURN NEW;
  END IF;

  SELECT "staffLimit", "staffRoleLimits", "ownerId" INTO quota, role_limits, owner_id
    FROM "stores" WHERE "id" = NEW."storeId" FOR UPDATE;
  IF NEW."id" = owner_id THEN RETURN NEW; END IF;
  SELECT "slug" INTO role_slug FROM "roles" WHERE "id" = NEW."roleId";
  IF role_slug = 'owner' THEN RETURN NEW; END IF;

  IF starts_counting AND quota IS NOT NULL THEN
    SELECT count(*) INTO used FROM "users"
      WHERE "storeId" = NEW."storeId" AND "isActive" AND "id" <> NEW."id"
        AND "id" IS DISTINCT FROM owner_id;
    IF used >= quota THEN
      RAISE EXCEPTION 'PLAN_LIMIT: staff %', quota USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF role_limits IS NOT NULL THEN
    IF role_slug IS NULL OR NOT (role_limits ? role_slug) THEN
      RAISE EXCEPTION 'PLAN_LIMIT: custom-role' USING ERRCODE = 'check_violation';
    END IF;
    role_quota := (role_limits ->> role_slug)::integer;
    SELECT count(*) INTO used FROM "users"
      WHERE "storeId" = NEW."storeId" AND "isActive" AND "roleId" = NEW."roleId"
        AND "id" <> NEW."id" AND "id" IS DISTINCT FROM owner_id;
    IF used >= role_quota THEN
      RAISE EXCEPTION 'PLAN_LIMIT: role % %', role_slug, role_quota USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
