-- Plan quotas, revision 2.
--
--   1. Staff accounts per plan become Basic 2 (one cashier and one inventory
--      staff), Business 10, Enterprise unlimited. The owner never counts.
--   2. A trial now follows the plan recorded on the store. It used to be
--      lifted to Business, so a store shown as Basic could add 15 staff and
--      5,000 products while on trial.
--
-- Only the quota copies on "stores" change (the trigger from migration
-- 20261025090000 reads them). No account, product or other row is changed
-- or deleted: a store already over its new limit keeps everything and simply
-- cannot add more until it is under the limit or upgraded.
--
-- Rollback: re-run the backfill from migration 20261025090000, then
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261102090000_staff_limits_v2';

-- Backfill. Must match PLANS in src/lib/plans.ts (tests/plans.test.ts checks).
UPDATE "stores" SET
  "productLimit" = CASE
    WHEN "plan" = 'ENTERPRISE' THEN NULL
    WHEN "plan" = 'BUSINESS' THEN 5000
    ELSE 500 END,
  "staffLimit" = CASE
    WHEN "plan" = 'ENTERPRISE' THEN NULL
    WHEN "plan" = 'BUSINESS' THEN 10
    ELSE 2 END;
-- End backfill.
