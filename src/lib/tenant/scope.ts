import { Prisma } from '@prisma/client';

/**
 * Store isolation rules: how every model is confined to one store.
 *
 * This file is the single place that decides which rows a store may see or
 * write. `scopeArgs` rewrites the arguments of one Prisma call so it can only
 * touch the given store; `src/lib/tenant/client.ts` applies it to every call
 * made through a store-scoped client.
 *
 * It is pure (no database access), so the rules are unit-tested directly in
 * tests/tenant-scope.test.ts.
 */

export type ModelScope =
  /** Has a NOT NULL `storeId`. */
  | { kind: 'store' }
  /** Has a nullable `storeId`; rows without one belong to the platform and are never visible. */
  | { kind: 'store-or-platform' }
  /** No column of its own; belongs to a store through a relation (`role`, `user`). */
  | { kind: 'via'; relation: string; foreignKey: string; target: string }
  /** Has a NOT NULL `storeId`; a store reads its own rows but only the platform writes them (subscription payments). */
  | { kind: 'store-readonly' }
  /** The store itself: a scoped client can only read its own row. Plans and status change on the platform side. */
  | { kind: 'self' }
  /** Shared reference data (the permission catalogue): read-only. */
  | { kind: 'reference' }
  /** Platform-only data a store never touches. */
  | { kind: 'denied' };

export const MODEL_SCOPES: Record<Prisma.ModelName, ModelScope> = {
  Store: { kind: 'self' },
  User: { kind: 'store-or-platform' },
  Role: { kind: 'store-or-platform' },
  Permission: { kind: 'reference' },
  RolePermission: { kind: 'via', relation: 'role', foreignKey: 'roleId', target: 'Role' },
  Session: { kind: 'via', relation: 'user', foreignKey: 'userId', target: 'User' },
  Account: { kind: 'via', relation: 'user', foreignKey: 'userId', target: 'User' },
  Passkey: { kind: 'via', relation: 'user', foreignKey: 'userId', target: 'User' },
  Verification: { kind: 'denied' },
  Category: { kind: 'store' },
  Product: { kind: 'store' },
  PriceHistory: { kind: 'store' },
  Warehouse: { kind: 'store' },
  Inventory: { kind: 'store' },
  InventoryTransaction: { kind: 'store' },
  CashierShift: { kind: 'store' },
  ShiftAdjustment: { kind: 'store' },
  Notification: { kind: 'store' },
  CashMovement: { kind: 'store' },
  Sale: { kind: 'store' },
  SaleItem: { kind: 'store' },
  Payment: { kind: 'store' },
  Return: { kind: 'store' },
  ReturnItem: { kind: 'store' },
  AuditLog: { kind: 'store-or-platform' },
  Setting: { kind: 'store' },
  StoreUsage: { kind: 'store' },
  SubscriptionPayment: { kind: 'store-readonly' },
  // A store reads its own invoices; only the billing service writes them.
  Invoice: { kind: 'store-readonly' },
  // Platform billing configuration and the administrator's notifications:
  // the billing service reads prices and terms deliberately, never a store client.
  PlanPrice: { kind: 'denied' },
  BillingTerms: { kind: 'denied' },
  PlatformSetting: { kind: 'denied' },
  PlatformNotification: { kind: 'denied' },
  Installation: { kind: 'denied' },
};

/** A call that tried to reach outside its store. Always a bug, never user error. */
export class StoreScopeError extends Error {
  constructor(message: string) {
    super(`Store isolation: ${message}`);
    this.name = 'StoreScopeError';
  }
}

const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const UPDATE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const DELETE_OPS = new Set(['delete', 'deleteMany']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = Record<string, unknown>;

/** Relation fields per model, from the generated client's own schema description. */
const RELATIONS: Map<string, Map<string, string>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map(model.fields.filter((field) => field.kind === 'object').map((field) => [field.name, field.type])),
  ]),
);

/**
 * Relations whose foreign key sits on the model itself (`category` on a
 * product, `shift` on a sale). Setting one of these is what makes a create
 * "checked" (relation objects); nested to-many creates (`items: { create }`)
 * are allowed in either style, so they say nothing about which one is in use.
 */
const OWNING_RELATIONS: Map<string, Set<string>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Set(
      model.fields
        .filter((field) => field.kind === 'object' && (field.relationFromFields?.length ?? 0) > 0)
        .map((field) => field.name),
    ),
  ]),
);

function isTagged(scope: ModelScope): boolean {
  return scope.kind === 'store' || scope.kind === 'store-or-platform' || scope.kind === 'store-readonly';
}

function scopeOf(model: string): ModelScope {
  const scope = MODEL_SCOPES[model as Prisma.ModelName];
  if (!scope) throw new StoreScopeError(`model ${model} has no isolation rule`);
  return scope;
}

function isObject(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function each<T>(value: T | T[] | undefined, fn: (item: T) => T): T | T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.map(fn) : fn(value);
}

/** Refuses a filter or value that names another store. */
function assertOwnStore(value: unknown, storeId: string, where: string) {
  if (value !== undefined && value !== storeId) {
    throw new StoreScopeError(`${where} names a different store`);
  }
}

/** Adds the store condition to a `where`, keeping any unique selector at the top level. */
function scopeWhere(model: string, where: unknown, storeId: string): Args {
  const base: Args = isObject(where) ? { ...where } : {};
  const scope = scopeOf(model);

  if (isTagged(scope)) {
    assertOwnStore(base.storeId, storeId, `${model} filter`);
    // Per-store unique keys (`storeId_sku`, `storeId_key`, …) carry the store
    // too; one naming another store must be refused, not quietly overridden.
    for (const [field, value] of Object.entries(base)) {
      if (field.startsWith('storeId_') && isObject(value)) {
        assertOwnStore(value.storeId, storeId, `${model} ${field}`);
      }
    }
    return { ...base, storeId };
  }
  if (scope.kind === 'self') {
    assertOwnStore(base.id, storeId, 'Store filter');
    return { ...base, id: storeId };
  }
  if (scope.kind === 'via') {
    // `AND` sits beside a unique selector without disturbing it.
    const and = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
    return { ...base, AND: [...and, { [scope.relation]: { storeId } }] };
  }
  return base;
}

/** A `connect`/`connectOrCreate` selector for a related row: it must be in this store too. */
function scopeConnect(model: string, where: unknown, storeId: string): unknown {
  const scope = scopeOf(model);
  return isTagged(scope) && isObject(where) ? scopeWhere(model, where, storeId) : where;
}

/**
 * Tags a row about to be created with the store, then walks its nested
 * writes so related rows created in the same call are tagged as well.
 */
function tagCreate(model: string, data: unknown, storeId: string): unknown {
  if (!isObject(data)) return data;
  const owning = OWNING_RELATIONS.get(model) ?? new Set<string>();
  const out = scopeNestedWrites(model, data, storeId);

  if (isTagged(scopeOf(model))) {
    assertOwnStore(out.storeId, storeId, `${model} data`);
    if (isObject(out.store)) {
      const connect = (out.store as Args).connect;
      if (!isObject(connect) || connect.id !== storeId) {
        throw new StoreScopeError(`${model} data links a different store`);
      }
      return out;
    }
    // Prisma accepts either relation objects ("checked" input) or raw foreign
    // keys ("unchecked"), never both, so the store goes in the same style.
    // Only a relation this row owns marks the checked style.
    const checked = Object.keys(out).some((key) => owning.has(key));
    if (checked) out.store = { connect: { id: storeId } };
    else out.storeId = storeId;
  }
  return out;
}

/** Applies the store rules to every nested write inside a create or update payload. */
function scopeNestedWrites(model: string, data: Args, storeId: string): Args {
  const relations = RELATIONS.get(model);
  if (!relations) return { ...data };
  const out: Args = { ...data };

  for (const [field, target] of relations) {
    const ops = out[field];
    if (!isObject(ops)) continue;
    const next: Args = { ...ops };

    if ('create' in next) next.create = each(next.create, (row) => tagCreate(target, row, storeId));
    if (isObject(next.createMany)) {
      next.createMany = {
        ...next.createMany,
        data: each(next.createMany.data, (row) => tagCreate(target, row, storeId)),
      };
    }
    if ('connect' in next) next.connect = each(next.connect, (where) => scopeConnect(target, where, storeId));
    if ('connectOrCreate' in next) {
      next.connectOrCreate = each(next.connectOrCreate as Args | Args[], (item) => ({
        ...item,
        where: scopeConnect(target, item.where, storeId),
        create: tagCreate(target, item.create, storeId),
      }));
    }
    if ('upsert' in next) {
      next.upsert = each(next.upsert as Args | Args[], (item) => ({
        ...item,
        create: tagCreate(target, item.create, storeId),
        update: isObject(item.update) ? scopeNestedWrites(target, item.update, storeId) : item.update,
      }));
    }
    if ('update' in next) {
      next.update = each(next.update as Args | Args[], (item) =>
        // To-many: { where, data }. To-one: the data itself.
        isObject(item.data)
          ? { ...item, data: scopeNestedWrites(target, item.data, storeId) }
          : scopeNestedWrites(target, item, storeId),
      );
    }
    out[field] = next;
  }

  if (isTagged(scopeOf(model)) && 'storeId' in out) {
    assertOwnStore(out.storeId, storeId, `${model} data`);
  }
  return out;
}

/**
 * Rewrites the arguments of one Prisma call so it can only reach `storeId`.
 * Throws `StoreScopeError` for a call that could not be confined.
 */
export function scopeArgs(model: string, operation: string, args: unknown, storeId: string): Args {
  if (!storeId) throw new StoreScopeError('no store selected');
  const scope = scopeOf(model);
  const input: Args = isObject(args) ? { ...args } : {};

  if (scope.kind === 'denied') throw new StoreScopeError(`${model} is not available to a store`);
  if (scope.kind === 'reference') {
    if (READ_OPS.has(operation)) return input;
    throw new StoreScopeError(`${model} is read-only for a store`);
  }
  if (scope.kind === 'store-readonly' && !READ_OPS.has(operation)) {
    throw new StoreScopeError(`${model} is written by the platform only`);
  }
  if (scope.kind === 'self' && !READ_OPS.has(operation)) {
    throw new StoreScopeError(`a store cannot ${operation} its store record`);
  }

  if (READ_OPS.has(operation) || DELETE_OPS.has(operation)) {
    return { ...input, where: scopeWhere(model, input.where, storeId) };
  }
  if (UPDATE_OPS.has(operation)) {
    if (isObject(input.data) && 'storeId' in input.data) {
      throw new StoreScopeError(`${model} rows cannot move to another store`);
    }
    return {
      ...input,
      where: scopeWhere(model, input.where, storeId),
      data: isObject(input.data) ? scopeNestedWrites(model, input.data, storeId) : input.data,
    };
  }
  if (operation === 'upsert') {
    return {
      ...input,
      where: scopeWhere(model, input.where, storeId),
      create: tagCreate(model, input.create, storeId),
      update: isObject(input.update) ? scopeNestedWrites(model, input.update, storeId) : input.update,
    };
  }
  if (CREATE_OPS.has(operation)) {
    if (operation === 'create') return { ...input, data: tagCreate(model, input.data, storeId) };
    // createMany only accepts raw foreign keys.
    return {
      ...input,
      data: each(input.data as Args | Args[], (row) =>
        isTagged(scope) ? (assertOwnStore(row.storeId, storeId, `${model} data`), { ...row, storeId }) : row,
      ),
    };
  }
  throw new StoreScopeError(`${model}.${operation} is not supported by the store-scoped client`);
}

/**
 * For models scoped through a relation (role permissions, sessions), the
 * foreign keys a create would write. The client checks they all belong to the
 * store before letting the create run, since there is no column to tag.
 */
export function foreignKeysToVerify(
  model: string,
  operation: string,
  args: unknown,
): { target: string; ids: string[] } | null {
  const scope = scopeOf(model);
  if (scope.kind !== 'via' || !(CREATE_OPS.has(operation) || operation === 'upsert')) return null;
  const input: Args = isObject(args) ? args : {};
  const rows = operation === 'upsert' ? [input.create] : Array.isArray(input.data) ? input.data : [input.data];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!isObject(row)) continue;
    const direct = row[scope.foreignKey];
    const connected = isObject(row[scope.relation]) ? ((row[scope.relation] as Args).connect as Args | undefined)?.id : undefined;
    const id = direct ?? connected;
    if (typeof id !== 'string') throw new StoreScopeError(`${model} create must name its ${scope.relation}`);
    ids.add(id);
  }
  return { target: scope.target, ids: [...ids] };
}

// --- Read-only stores ---------------------------------------------------------

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** The text of a raw query (placeholders for its values), however it was passed. */
function rawSqlText(args: unknown): string {
  const fromParts = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join(' ? ');
    if (value && typeof value === 'object') {
      const sql = value as { sql?: unknown; strings?: unknown };
      if (Array.isArray(sql.strings)) return sql.strings.join(' ? ');
      if (typeof sql.sql === 'string') return sql.sql;
    }
    return null;
  };
  if (Array.isArray(args) && args.length > 0 && !args.every((part) => typeof part === 'string')) {
    return fromParts(args[0]) ?? '';
  }
  return fromParts(args) ?? '';
}

const RAW_WRITE = /^\s*(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|copy|call|do)\b/i;
/** A data-modifying statement inside a CTE (`WITH x AS (DELETE FROM ...)`). */
const CTE_WRITE = /\b(insert\s+into|update\s+"?\w+"?\s+set|delete\s+from|merge\s+into)\b/i;

/**
 * Whether a raw query writes: one that starts with a writing statement, or a
 * CTE (`WITH ...`) that contains one. The app's raw reads are SELECTs and
 * read-only CTEs.
 */
export function isRawWrite(args: unknown): boolean {
  const sql = rawSqlText(args);
  if (RAW_WRITE.test(sql)) return true;
  return /^\s*with\b/i.test(sql) && CTE_WRITE.test(sql);
}

/**
 * Whether a read-only store's client refuses this model call. The audit trail
 * still records what happens (sign-ins, exports): it is append-only and
 * changes no business data.
 */
export function isReadOnlyRefused(model: string, operation: string): boolean {
  if (!WRITE_OPERATIONS.has(operation)) return false;
  return !(model === 'AuditLog' && operation === 'create');
}
