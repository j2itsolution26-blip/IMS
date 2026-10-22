-- Fixes the cross-store check in "tenant_guard" (migration 20261023090000).
--
-- The guard looked up each referenced row with EXECUTE ... INTO and then
-- tested FOUND. PL/pgSQL never sets FOUND from EXECUTE, so the test was always
-- false and a row could point at another store's row; only the "cannot move to
-- another store" half worked. GET DIAGNOSTICS ROW_COUNT is set by EXECUTE.
--
-- Replaces the function body only. Every trigger already calls it by name and
-- keeps its arguments, so no trigger, table or row changes. Rows written while
-- the check was inert are not re-validated here; with one store in production
-- there could be none, and the integration suite checks new writes.
--
-- Rollback: re-run the CREATE OR REPLACE FUNCTION from 20261023090000.

CREATE OR REPLACE FUNCTION "tenant_guard"() RETURNS trigger AS $$
DECLARE
  i integer;
  ref_id text;
  ref_store text;
  matched integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."storeId" IS DISTINCT FROM OLD."storeId" THEN
    RAISE EXCEPTION '% rows cannot move to another store', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  FOR i IN 0 .. (TG_NARGS / 2) - 1 LOOP
    EXECUTE format('SELECT ($1).%I::text', TG_ARGV[i * 2]) INTO ref_id USING NEW;
    CONTINUE WHEN ref_id IS NULL;
    EXECUTE format('SELECT "storeId" FROM %I WHERE "id" = $1', TG_ARGV[i * 2 + 1])
      INTO ref_store USING ref_id;
    GET DIAGNOSTICS matched = ROW_COUNT;
    -- A reference to a row that does not exist is left to the foreign key.
    IF matched > 0 AND ref_store IS DISTINCT FROM NEW."storeId" THEN
      RAISE EXCEPTION '%.% refers to a row of another store', TG_TABLE_NAME, TG_ARGV[i * 2]
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
