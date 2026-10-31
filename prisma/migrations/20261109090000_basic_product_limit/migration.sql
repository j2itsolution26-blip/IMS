-- Plan quotas, revision 3: the Basic plan allows 1,500 products (was 500).
--
-- Only the quota copies on "stores" change (the "enforce_store_quota"
-- trigger from migration 20261025090000 reads them). The limits always
-- follow the store's plan, so recomputing every store is safe and repeatable.
-- No product, subscription, invoice or payment row is changed or deleted.
--
-- Rollback: re-run the backfill from migration 20261102090000, then
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261109090000_basic_product_limit';

-- Backfill. Must match PLANS in src/lib/plans.ts (tests/plans.test.ts checks).
UPDATE "stores" SET
  "productLimit" = CASE
    WHEN "plan" = 'ENTERPRISE' THEN NULL
    WHEN "plan" = 'BUSINESS' THEN 5000
    ELSE 1500 END,
  "staffLimit" = CASE
    WHEN "plan" = 'ENTERPRISE' THEN NULL
    WHEN "plan" = 'BUSINESS' THEN 10
    ELSE 2 END;
-- End backfill.
