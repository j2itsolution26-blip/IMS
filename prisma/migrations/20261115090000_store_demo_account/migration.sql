-- A demonstration account for each store.
--
--   stores."demoOfStoreId": on a demo store, the real store it was made for.
--   Each real store has at most one (unique), only a demo store may carry it
--   (CHECK), it can never point at another demo store, and it never changes
--   once set (trigger). The demo store is a separate store with its own
--   owner login and sample data: every isolation rule that keeps stores apart
--   keeps the demo away from the real store's sales, stock, cash and billing.
--
-- No existing row changes.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS "stores_demo_link_fixed" ON "stores";
--   DROP FUNCTION IF EXISTS "stores_demo_link_fixed"();
--   ALTER TABLE "stores" DROP COLUMN "demoOfStoreId";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261115090000_store_demo_account';

ALTER TABLE "stores" ADD COLUMN "demoOfStoreId" TEXT;
ALTER TABLE "stores" ADD CONSTRAINT "stores_demoOfStoreId_fkey"
  FOREIGN KEY ("demoOfStoreId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "stores_demoOfStoreId_key" ON "stores"("demoOfStoreId");
ALTER TABLE "stores" ADD CONSTRAINT "stores_demo_link_only_on_demo"
  CHECK ("demoOfStoreId" IS NULL OR ("isDemo" AND "demoOfStoreId" <> "id"));

CREATE OR REPLACE FUNCTION "stores_demo_link_fixed"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."demoOfStoreId" IS DISTINCT FROM OLD."demoOfStoreId" THEN
    RAISE EXCEPTION 'A demo store stays linked to the store it was made for' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."demoOfStoreId" IS NOT NULL
     AND EXISTS (SELECT 1 FROM "stores" WHERE "id" = NEW."demoOfStoreId" AND "isDemo") THEN
    RAISE EXCEPTION 'A demo store is made for a real store, not another demo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stores_demo_link_fixed"
  BEFORE INSERT OR UPDATE OF "demoOfStoreId" ON "stores"
  FOR EACH ROW EXECUTE FUNCTION "stores_demo_link_fixed"();
