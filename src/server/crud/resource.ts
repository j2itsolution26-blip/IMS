import 'server-only';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { diff, recordAudit } from '@/server/services/audit-service';
import type { PermissionKey } from '@/lib/permissions';

/**
 * A create/update/delete factory for the straightforward reference entities —
 * categories and units.
 *
 * These differ only in their fields, their permissions, and their delete
 * guards; the permission check, validation, audit entry, and cache
 * invalidation are identical. Writing that twice would mean two places to
 * fix the next time one of them changes.
 *
 * Products, sales, and returns are deliberately NOT built on this — they
 * carry real domain rules and live in their own services.
 */

/** Prisma's generated delegates have no common supertype, so the model is addressed by name. */
type ModelName = 'category' | 'unit';

export interface ResourceConfig<TCreate extends z.ZodTypeAny, TUpdate extends z.ZodTypeAny> {
  model: ModelName;
  /** Singular, human-readable — used in audit summaries and error messages. */
  label: string;
  /** Audit entity name, e.g. "Category". */
  entity: string;
  permissions: {
    create: PermissionKey;
    update: PermissionKey;
    delete: PermissionKey;
  };
  createSchema: TCreate;
  updateSchema: TUpdate;
  /** Paths whose cached render must be discarded after a write. */
  revalidate: string[];
  /**
   * Blocks a delete that would orphan dependent records. Returns a message to
   * show the user, or null when deletion is safe.
   */
  guardDelete?: (id: string) => Promise<string | null>;
  /** Derives extra fields (slugs, normalised codes) before writing. */
  transform?: (input: Record<string, unknown>) => Record<string, unknown>;
  /** Field used in the audit summary. Defaults to `name`. */
  displayField?: string;
}

export interface ResourceActions {
  create: (input: unknown) => Promise<ActionResult<{ id: string }>>;
  update: (id: string, input: unknown) => Promise<ActionResult<{ id: string }>>;
  remove: (id: string) => Promise<ActionResult<void>>;
}

export function createResourceActions<TCreate extends z.ZodTypeAny, TUpdate extends z.ZodTypeAny>(
  config: ResourceConfig<TCreate, TUpdate>,
): ResourceActions {
  const displayField = config.displayField ?? 'name';

  // The delegate is resolved by name; the shapes are guaranteed by the Zod
  // schemas the caller supplies, which is where the real type safety lives.
  const delegate = () => prisma[config.model] as unknown as {
    create: (args: { data: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
      select: { id: true };
    }) => Promise<{ id: string }>;
    findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };

  const invalidate = () => {
    for (const path of config.revalidate) revalidatePath(path);
  };

  return {
    async create(input: unknown) {
      return runAction(async () => {
        const user = await authorize(config.permissions.create);
        const parsed = parseInput(config.createSchema, input) as Record<string, unknown>;
        const data = config.transform ? config.transform(parsed) : parsed;

        const record = await delegate().create({ data, select: { id: true } });

        await recordAudit({
          action: 'CREATE',
          entity: config.entity,
          entityId: record.id,
          summary: `Created ${config.label} "${String(data[displayField] ?? record.id)}"`,
          changes: data as never,
          userId: user.id,
        });

        invalidate();
        return { id: record.id };
      });
    },

    async update(id: string, input: unknown) {
      return runAction(async () => {
        const user = await authorize(config.permissions.update);
        const parsed = parseInput(config.updateSchema, input) as Record<string, unknown>;
        const data = config.transform ? config.transform(parsed) : parsed;

        const before = await delegate().findUnique({ where: { id } });
        if (!before) throw new NotFoundError(config.label);

        const record = await delegate().update({ where: { id }, data, select: { id: true } });

        await recordAudit({
          action: 'UPDATE',
          entity: config.entity,
          entityId: id,
          summary: `Updated ${config.label} "${String(data[displayField] ?? before[displayField] ?? id)}"`,
          changes: diff(before, { ...before, ...data }),
          userId: user.id,
        });

        invalidate();
        return { id: record.id };
      });
    },

    async remove(id: string) {
      return runAction(async () => {
        const user = await authorize(config.permissions.delete);

        const before = await delegate().findUnique({ where: { id } });
        if (!before) throw new NotFoundError(config.label);

        // Deleting something still referenced by stock or history would either
        // fail at the database or silently orphan records, so it is checked here
        // with a message that says what is in the way.
        if (config.guardDelete) {
          const blocker = await config.guardDelete(id);
          if (blocker) throw new ConflictError(blocker);
        }

        await delegate().delete({ where: { id } });

        await recordAudit({
          action: 'DELETE',
          entity: config.entity,
          entityId: id,
          summary: `Deleted ${config.label} "${String(before[displayField] ?? id)}"`,
          userId: user.id,
        });

        invalidate();
      });
    },
  };
}

/** Builds a "still in use by N X" message, or null when the count is zero. */
export function blockIfUsed(count: number, noun: string, label: string): string | null {
  if (count === 0) return null;
  return `This ${label} is still used by ${count} ${noun}${count === 1 ? '' : 's'}. Reassign or remove ${
    count === 1 ? 'it' : 'them'
  } first.`;
}
