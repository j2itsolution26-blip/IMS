-- First-time setup state.
--
--   1. installation: a single row (id = 1, enforced) recording whether the
--      first System Administrator has been created through /setup.
--   2. Backfill: an installation that already has any account is marked
--      COMPLETED, so setup can never reopen on an existing system — not even
--      if every administrator is later disabled or deleted.
--   3. Fresh databases only: removes the empty "store_default" that migration
--      20261023090000 always creates (as the home for pre-existing data). On a
--      new installation it would be an ownerless, never-expiring Enterprise
--      store; stores now come from System Admin → Create store, with a trial.
--      Kept whenever any account exists or anything belongs to it.
--
-- Setup is open only while there is no COMPLETED row AND no account exists;
-- the application checks both on the server.
--
-- No existing row changes on a system that has accounts.
--
-- Rollback (in this order):
--   DROP TABLE IF EXISTS "installation";
--   DROP TYPE IF EXISTS "InstallationStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261027090000_installation_setup';

-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "installation" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "status" "InstallationStatus" NOT NULL,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "installation_pkey" PRIMARY KEY ("id"),
    -- One row per installation, ever.
    CONSTRAINT "installation_single_row" CHECK ("id" = 1),
    -- A completed setup stays completed: it has a completion time and no live claim.
    CONSTRAINT "installation_state" CHECK (
      ("status" = 'IN_PROGRESS' AND "claimToken" IS NOT NULL AND "claimedAt" IS NOT NULL AND "completedAt" IS NULL)
      OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "claimToken" IS NULL)
    )
);

-- AddForeignKey
ALTER TABLE "installation" ADD CONSTRAINT "installation_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A completed setup can never be turned back into an open one.
CREATE OR REPLACE FUNCTION "installation_stays_completed"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'COMPLETED' THEN
      RAISE EXCEPTION 'a completed installation cannot be reset this way' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'COMPLETED' AND NEW."status" <> 'COMPLETED' THEN
    RAISE EXCEPTION 'a completed installation cannot be reopened' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "installation_stays_completed"
  BEFORE UPDATE OR DELETE ON "installation"
  FOR EACH ROW EXECUTE FUNCTION "installation_stays_completed"();

-- 3. A fresh database's unused default store.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "users") THEN
    BEGIN
      DELETE FROM "stores" WHERE "id" = 'store_default' AND "ownerId" IS NULL;
    EXCEPTION WHEN foreign_key_violation THEN
      NULL; -- roles, settings or records already belong to it: keep it
    END;
  END IF;
END $$;

-- Existing systems: already set up. Credited to the earliest platform
-- administrator if there is one. (Times are stored in UTC, like Prisma's.)
INSERT INTO "installation" ("id", "status", "completedAt", "completedById")
SELECT 1, 'COMPLETED', timezone('UTC', now()),
  (SELECT u."id" FROM "users" u JOIN "roles" r ON r."id" = u."roleId"
   WHERE r."slug" = 'system-admin' AND u."storeId" IS NULL
   ORDER BY u."createdAt" LIMIT 1)
WHERE EXISTS (SELECT 1 FROM "users");
