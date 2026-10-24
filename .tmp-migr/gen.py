import re

base = open('.tmp-migr/base.sql', encoding='utf-8').read()
blocks = ['-- ' + b.strip() for b in base.lstrip('- ').split('\n\n-- ') if b.strip()]


def pick(pred):
    return [b for b in blocks if pred(b)]


enums = pick(lambda b: 'CREATE TYPE' in b)
drops = pick(lambda b: 'DROP INDEX' in b)
create_store = pick(lambda b: 'CREATE TABLE "stores"' in b)
indexes = pick(lambda b: 'CREATE' in b and 'INDEX' in b)
fks = pick(lambda b: 'ADD CONSTRAINT' in b)
adds = pick(lambda b: 'ADD COLUMN' in b)
assert len(enums) + len(drops) + len(create_store) + len(indexes) + len(fks) + len(adds) == len(blocks)


def tbl(b):
    return re.search(r'ALTER TABLE "(\w+)"', b).group(1)


not_null = [tbl(b) for b in adds if 'NOT NULL' in b]
nullable = [tbl(b) for b in adds if 'NOT NULL' not in b]
assert sorted(nullable) == ['audit_logs', 'roles', 'users'], nullable

out = []
out.append("""-- Multi-store foundation.
--
-- Turns the single-store schema into a multi-store one without losing or
-- rewriting any record:
--
--   1. Creates `stores` and one default store ("store_default") that every
--      existing row is moved into. It is named after the current
--      `company.name` setting, owned by the existing owner, and starts on the
--      ENTERPRISE plan as ACTIVE so no feature is lost once plans exist.
--   2. Adds `storeId` to every store-owned table. NOT NULL columns are added
--      with a constant DEFAULT, which fills existing rows without an UPDATE
--      (so the append-only and closed-shift triggers never fire), and the
--      default is dropped straight after: from then on the application must
--      say which store a row belongs to, and a row it forgets is rejected.
--   3. Replaces platform-wide unique keys (SKU, barcode, invoice number,
--      setting key, ...) with per-store ones.
--   4. Adds "tenant_guard" triggers so a row can never reference a row of
--      another store, and can never move to another store.
--
-- Platform rows stay outside any store: the System Administrator role, its
-- users, and audit entries they wrote keep a NULL storeId.
--
-- Deploy note: the application released with this migration sets storeId on
-- every insert. Code from before it does not, so run this migration and
-- deploy the new code together, outside opening hours.""")
out.append('-- 1. Stores ' + '-' * 64)
out += enums
out += create_store
out.append("""INSERT INTO "stores" ("id", "name", "slug", "plan", "status", "createdAt", "updatedAt")
VALUES (
  'store_default',
  COALESCE(
    (SELECT NULLIF(btrim("value"), '') FROM "settings" WHERE "key" = 'company.name'),
    'My Store'
  ),
  'main',
  'ENTERPRISE',
  'ACTIVE',
  now(),
  now()
);""")
out.append('-- 2. storeId columns ' + '-' * 56)
out.append('-- Platform-wide unique keys become per-store keys (recreated in step 3).')
out += drops
for t in not_null:
    out.append(f'ALTER TABLE "{t}" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT \'store_default\';\n'
               f'ALTER TABLE "{t}" ALTER COLUMN "storeId" DROP DEFAULT;')
out.append("""-- Users, roles and audit entries: everything except the platform's own.
ALTER TABLE "roles" ADD COLUMN "storeId" TEXT;
UPDATE "roles" SET "storeId" = 'store_default' WHERE "slug" <> 'system-admin';

ALTER TABLE "users" ADD COLUMN "storeId" TEXT;
UPDATE "users" u SET "storeId" = r."storeId" FROM "roles" r WHERE r."id" = u."roleId";

-- The audit trail's own guard allows this: storeId is not one of the columns
-- it freezes, and no existing entry's content changes.
ALTER TABLE "audit_logs" ADD COLUMN "storeId" TEXT;
UPDATE "audit_logs" a SET "storeId" = 'store_default'
WHERE a."userId" IS NULL
   OR EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."userId" AND u."storeId" IS NOT NULL);

-- The existing owner owns the default store.
UPDATE "stores" SET "ownerId" = (
  SELECT u."id" FROM "users" u JOIN "roles" r ON r."id" = u."roleId"
  WHERE r."slug" = 'owner' AND u."storeId" = 'store_default'
  ORDER BY u."createdAt", u."id" LIMIT 1
)
WHERE "id" = 'store_default';""")
out.append('-- 3. Keys and indexes ' + '-' * 55)
out += indexes
out.append("""-- The System Administrator role has no store. NULLs never collide in a
-- unique index, so the global role gets its own.
CREATE UNIQUE INDEX "roles_global_slug_key" ON "roles"("slug") WHERE "storeId" IS NULL;
CREATE UNIQUE INDEX "roles_global_name_key" ON "roles"("name") WHERE "storeId" IS NULL;

-- Only the System Administrator role lives outside a store. Together with the
-- users guard below (a user's store must match their role's), this means the
-- only accounts without a store are system administrators.
ALTER TABLE "roles" ADD CONSTRAINT "roles_store_or_platform"
  CHECK ("storeId" IS NOT NULL OR "slug" = 'system-admin');""")
out += fks

guards = {
    'users': ['roleId', 'roles'],
    'roles': [],
    'categories': ['parentId', 'categories'],
    'products': ['categoryId', 'categories'],
    'price_history': ['productId', 'products'],
    'warehouses': [],
    'inventory': ['productId', 'products', 'warehouseId', 'warehouses'],
    'inventory_transactions': ['productId', 'products', 'warehouseId', 'warehouses', 'userId', 'users'],
    'cashier_shifts': ['userId', 'users', 'closedById', 'users', 'reviewedById', 'users'],
    'shift_adjustments': ['shiftId', 'cashier_shifts', 'userId', 'users'],
    'notifications': ['shiftId', 'cashier_shifts', 'readById', 'users'],
    'cash_movements': ['shiftId', 'cashier_shifts', 'userId', 'users'],
    'sales': ['warehouseId', 'warehouses', 'userId', 'users', 'shiftId', 'cashier_shifts'],
    'sale_items': ['saleId', 'sales', 'productId', 'products'],
    'payments': ['saleId', 'sales', 'returnId', 'returns', 'userId', 'users', 'shiftId', 'cashier_shifts'],
    'returns': ['saleId', 'sales', 'userId', 'users'],
    'return_items': ['returnId', 'returns', 'productId', 'products', 'saleItemId', 'sale_items'],
    'audit_logs': ['userId', 'users'],
    'settings': [],
}
assert set(guards) == set(not_null + nullable), set(not_null + nullable) ^ set(guards)
out.append('-- 4. Store isolation guards ' + '-' * 49)
out.append("""-- Refuses any row that points at a row of another store, and any change of a
-- row's store. Arguments are (column, referenced table) pairs. A reference
-- to a row that does not exist is left to the foreign key to report.
-- A NULL store matches a NULL store, so platform users keep the platform role.
CREATE FUNCTION "tenant_guard"() RETURNS trigger AS $$
DECLARE
  i integer;
  ref_id text;
  ref_store text;
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
    IF FOUND AND ref_store IS DISTINCT FROM NEW."storeId" THEN
      RAISE EXCEPTION '%.% refers to a row of another store', TG_TABLE_NAME, TG_ARGV[i * 2]
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;""")
for t, args in guards.items():
    cols = ['"storeId"'] + [f'"{args[i]}"' for i in range(0, len(args), 2)]
    argstr = ', '.join(f"'{a}'" for a in args)
    out.append(f'CREATE TRIGGER "{t}_tenant_guard"\n  BEFORE INSERT OR UPDATE OF {", ".join(cols)} ON "{t}"\n'
               f'  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"({argstr});')

rb = ['-- ' + '-' * 75,
      '-- Rollback (manual; run only to undo this migration, after restoring the',
      '-- previous application code, and only while a single store exists):',
      '--']
for t in guards:
    rb.append(f'--   DROP TRIGGER IF EXISTS "{t}_tenant_guard" ON "{t}";')
rb.append('--   DROP FUNCTION IF EXISTS "tenant_guard"();')
rb.append('--   DROP INDEX IF EXISTS "roles_global_slug_key";')
rb.append('--   DROP INDEX IF EXISTS "roles_global_name_key";')
rb.append('--   ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_store_or_platform";')
for t in guards:
    rb.append(f'--   ALTER TABLE "{t}" DROP COLUMN "storeId";')
rb.append('--   DROP TABLE "stores";')
rb.append('--   DROP TYPE "StoreStatus";')
rb.append('--   DROP TYPE "StorePlan";')
rb.append('--   Then recreate the single-column unique indexes dropped in step 2:')
for d in drops:
    name = re.search(r'DROP INDEX "(\w+)"', d).group(1)
    col = name.rsplit('_', 2)
    rb.append(f'--     {name}')
out.append('\n'.join(rb))
open('prisma/migrations/20261023090000_multi_store_foundation/migration.sql', 'w', encoding='utf-8', newline='\n').write('\n\n'.join(out) + '\n')
print('blocks', len(out))
