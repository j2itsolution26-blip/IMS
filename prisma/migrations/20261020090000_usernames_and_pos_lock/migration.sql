-- Usernames, POS lock screen and unlock PIN.
--
-- Additive only: no user, sale, stock or audit row is deleted or rewritten
-- beyond filling the new `username` column.
--
-- Existing accounts receive a username derived from their email's local part,
-- cleaned to the allowed characters ([a-z0-9_.]), padded to 3 characters and
-- capped at 24 so a suffix still fits. Clashes are resolved oldest-account-first
-- with `_2`, `_3`… checked against every username already assigned, so no two
-- accounts can ever share one. `suggestUsername` in src/lib/username.ts mirrors
-- this exactly and is unit-tested.

-- 1. New columns, nullable while they are filled.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "displayUsername" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "posPinHash" TEXT;

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "unlockFailures" INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill a unique username for every existing account.
DO $$
DECLARE
  account RECORD;
  stem TEXT;
  candidate TEXT;
  n INTEGER;
BEGIN
  FOR account IN
    SELECT id, email FROM "users" WHERE "username" IS NULL ORDER BY "createdAt", id
  LOOP
    stem := regexp_replace(lower(split_part(account.email, '@', 1)), '[^a-z0-9_.]', '', 'g');
    IF stem = '' THEN
      stem := 'user';
    END IF;
    stem := left(rpad(stem, greatest(length(stem), 3), '0'), 24);

    candidate := stem;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM "users" WHERE "username" = candidate) LOOP
      n := n + 1;
      candidate := stem || '_' || n;
    END LOOP;

    UPDATE "users" SET "username" = candidate, "displayUsername" = candidate WHERE id = account.id;
  END LOOP;
END $$;

-- 3. Required and unique from here on. Every value is stored trimmed and
--    lowercase, so this plain unique index is a case-insensitive one.
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_normalized";
ALTER TABLE "users" ADD CONSTRAINT "users_username_normalized"
  CHECK ("username" = lower(btrim("username")) AND "username" ~ '^[a-z0-9_.]{3,30}$');
