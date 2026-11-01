-- Staff role slots.
--
--   1. Adds "staffRoleLimit" to stores: the most active accounts each built-in
--      staff role may have (Basic: 1 Cashier and 1 Inventory Staff), copied
--      from src/lib/plans.ts like the other quotas. Empty = no per-role cap
--      (Business, Enterprise).
--   2. Replaces "enforce_store_quota" so that, for users, it also:
--        * runs when an account's role changes, not only when it is created,
--          reactivated or moved, so a role change cannot fill a taken slot;
--        * refuses an account over its role's slot ("PLAN_LIMIT: role cashier 1");
--        * on a store with role slots, refuses any role other than Cashier and
--          Inventory Staff for an active account ("PLAN_LIMIT: custom-role"),
--          because a custom role would sidestep the slots;
--        * never counts the owner, either by the store's ownerId or the Owner role.
--      It still locks the store's row first, so concurrent creates, role
--      changes and reactivations for one store take turns and cannot both
--      pass the count.
--
-- Only accounts that start counting are checked: a new active account, one
-- reactivated or moved into the store, or an active one whose role changes.
-- Editing a name, phone or username never is, so a store already over its
-- new limits keeps every account and can still edit them; it just cannot add,
-- reactivate or move anyone into a full slot. No user, sale, shift or audit
-- row is changed or deleted.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS "users_store_quota" ON "users";
--   re-run the CREATE FUNCTION "enforce_store_quota" and both CREATE TRIGGER
--   statements from migration 20261025090000;
--   ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_staff_role_limit_non_negative";
--   ALTER TABLE "stores" DROP COLUMN IF EXISTS "staffRoleLimit";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111090000_staff_role_slots';

ALTER TABLE "stores" ADD COLUMN "staffRoleLimit" INTEGER;

ALTER TABLE "stores" ADD CONSTRAINT "stores_staff_role_limit_non_negative"
  CHECK ("staffRoleLimit" IS NULL OR "staffRoleLimit" >= 0);

-- Backfill. Must match PLANS[*].staffPerRole in src/lib/plans.ts (tests/plans.test.ts checks).
UPDATE "stores" SET
  "staffRoleLimit" = CASE
    WHEN "plan" = 'BASIC' THEN 1
    ELSE NULL END;
-- End backfill.

CREATE OR REPLACE FUNCTION "enforce_store_quota"() RETURNS trigger AS $$
DECLARE
  quota integer;
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
    -- Unchanged from migration 20261025090000.
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

  -- A new active account, or one reactivated or moved into the store, takes a
  -- seat in the total. An active account whose role changes keeps its seat
  -- but moves to another role's slot.
  starts_counting := NOT (TG_OP = 'UPDATE' AND OLD."isActive" AND OLD."storeId" IS NOT DISTINCT FROM NEW."storeId");
  IF NOT starts_counting AND OLD."roleId" IS NOT DISTINCT FROM NEW."roleId" THEN
    RETURN NEW;
  END IF;

  SELECT "staffLimit", "staffRoleLimit", "ownerId" INTO quota, role_quota, owner_id
    FROM "stores" WHERE "id" = NEW."storeId" FOR UPDATE;
  -- The owner never counts against the staff quota or a slot.
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

  IF role_quota IS NOT NULL THEN
    IF role_slug IS NULL OR role_slug NOT IN ('cashier', 'inventory-staff') THEN
      RAISE EXCEPTION 'PLAN_LIMIT: custom-role' USING ERRCODE = 'check_violation';
    END IF;
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

DROP TRIGGER IF EXISTS "users_store_quota" ON "users";
CREATE TRIGGER "users_store_quota"
  BEFORE INSERT OR UPDATE OF "isActive", "storeId", "roleId" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "enforce_store_quota"();
