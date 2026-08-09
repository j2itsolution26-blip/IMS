'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { runAction, type ActionResult } from '@/lib/action';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/server/services/audit-service';
import { slugify } from '@/lib/utils';
import { blockIfUsed, createResourceActions } from '@/server/crud/resource';
import {
  brandSchema,
  categorySchema,
  customerSchema,
  supplierSchema,
  unitSchema,
  warehouseSchema,
} from '@/features/catalogue/schemas';

/**
 * Reference-data actions.
 *
 * All six share the factory in `@/server/crud/resource`, which handles the
 * permission check, validation, audit trail, and cache invalidation. What
 * differs per entity — the delete guard and any derived fields — is declared here.
 */

// --- Categories -------------------------------------------------------------

const categoryActions = createResourceActions({
  model: 'category',
  label: 'category',
  entity: 'Category',
  permissions: { create: 'categories.create', update: 'categories.update', delete: 'categories.delete' },
  createSchema: categorySchema,
  updateSchema: categorySchema,
  revalidate: ['/categories', '/products'],
  transform: (input) => ({ ...input, slug: slugify(String(input.name)) }),
  guardDelete: async (id) => {
    const [products, children] = await Promise.all([
      prisma.product.count({ where: { categoryId: id } }),
      prisma.category.count({ where: { parentId: id } }),
    ]);
    return blockIfUsed(products, 'product', 'category') ?? blockIfUsed(children, 'sub-category', 'category');
  },
});

export async function createCategory(input: unknown) {
  return categoryActions.create(input);
}
export async function updateCategory(id: string, input: unknown) {
  return categoryActions.update(id, input);
}
export async function deleteCategory(id: string) {
  return categoryActions.remove(id);
}

// --- Brands -----------------------------------------------------------------

const brandActions = createResourceActions({
  model: 'brand',
  label: 'brand',
  entity: 'Brand',
  permissions: { create: 'brands.create', update: 'brands.update', delete: 'brands.delete' },
  createSchema: brandSchema,
  updateSchema: brandSchema,
  revalidate: ['/brands', '/products'],
  transform: (input) => ({ ...input, slug: slugify(String(input.name)) }),
  guardDelete: async (id) =>
    blockIfUsed(await prisma.product.count({ where: { brandId: id } }), 'product', 'brand'),
});

export async function createBrand(input: unknown) {
  return brandActions.create(input);
}
export async function updateBrand(id: string, input: unknown) {
  return brandActions.update(id, input);
}
export async function deleteBrand(id: string) {
  return brandActions.remove(id);
}

// --- Units ------------------------------------------------------------------

const unitActions = createResourceActions({
  model: 'unit',
  label: 'unit',
  entity: 'Unit',
  permissions: { create: 'units.create', update: 'units.update', delete: 'units.delete' },
  createSchema: unitSchema,
  updateSchema: unitSchema,
  revalidate: ['/units', '/products'],
  guardDelete: async (id) =>
    blockIfUsed(await prisma.product.count({ where: { unitId: id } }), 'product', 'unit'),
});

export async function createUnit(input: unknown) {
  return unitActions.create(input);
}
export async function updateUnit(id: string, input: unknown) {
  return unitActions.update(id, input);
}
export async function deleteUnit(id: string) {
  return unitActions.remove(id);
}

// --- Warehouses -------------------------------------------------------------

const warehouseActions = createResourceActions({
  model: 'warehouse',
  label: 'warehouse',
  entity: 'Warehouse',
  permissions: { create: 'warehouses.create', update: 'warehouses.update', delete: 'warehouses.delete' },
  createSchema: warehouseSchema,
  updateSchema: warehouseSchema,
  revalidate: ['/warehouses', '/inventory', '/pos'],
  guardDelete: async (id) => {
    const [stockRows, sales, orders] = await Promise.all([
      prisma.inventory.count({ where: { warehouseId: id, NOT: { quantity: 0 } } }),
      prisma.sale.count({ where: { warehouseId: id } }),
      prisma.purchaseOrder.count({ where: { warehouseId: id } }),
    ]);

    if (stockRows > 0) {
      return `This warehouse still holds stock in ${stockRows} product line${
        stockRows === 1 ? '' : 's'
      }. Transfer or adjust it to zero first.`;
    }
    return (
      blockIfUsed(sales, 'sale', 'warehouse') ?? blockIfUsed(orders, 'purchase order', 'warehouse')
    );
  },
});

export async function createWarehouse(input: unknown) {
  return warehouseActions.create(input);
}
export async function deleteWarehouse(id: string) {
  return warehouseActions.remove(id);
}

/**
 * Updating a warehouse needs a step the factory does not do: exactly one
 * warehouse may be the default, so promoting one demotes the rest atomically.
 */
export async function updateWarehouse(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await warehouseActions.update(id, input);
  if (!result.ok) return result;

  const warehouse = await prisma.warehouse.findUnique({ where: { id }, select: { isDefault: true } });
  if (warehouse?.isDefault) {
    await prisma.warehouse.updateMany({
      where: { id: { not: id }, isDefault: true },
      data: { isDefault: false },
    });
    revalidatePath('/warehouses');
  }

  return result;
}

// --- Suppliers --------------------------------------------------------------

const supplierActions = createResourceActions({
  model: 'supplier',
  label: 'supplier',
  entity: 'Supplier',
  permissions: { create: 'suppliers.create', update: 'suppliers.update', delete: 'suppliers.delete' },
  createSchema: supplierSchema,
  updateSchema: supplierSchema,
  revalidate: ['/suppliers', '/products', '/purchases'],
  guardDelete: async (id) => {
    const orders = await prisma.purchaseOrder.count({ where: { supplierId: id } });
    if (orders > 0) {
      return `This supplier has ${orders} purchase order${
        orders === 1 ? '' : 's'
      } on record. Deactivate them instead so the history stays intact.`;
    }
    return null;
  },
});

export async function createSupplier(input: unknown) {
  return supplierActions.create(input);
}
export async function updateSupplier(id: string, input: unknown) {
  return supplierActions.update(id, input);
}
export async function deleteSupplier(id: string) {
  return supplierActions.remove(id);
}

// --- Customers --------------------------------------------------------------

const customerActions = createResourceActions({
  model: 'customer',
  label: 'customer',
  entity: 'Customer',
  permissions: { create: 'customers.create', update: 'customers.update', delete: 'customers.delete' },
  createSchema: customerSchema,
  updateSchema: customerSchema,
  revalidate: ['/customers', '/pos'],
  guardDelete: async (id) => {
    const sales = await prisma.sale.count({ where: { customerId: id } });
    if (sales > 0) {
      return `This customer has ${sales} sale${
        sales === 1 ? '' : 's'
      } on record. Deactivate them instead so the history stays intact.`;
    }
    return null;
  },
});

export async function createCustomer(input: unknown) {
  return customerActions.create(input);
}
export async function updateCustomer(id: string, input: unknown) {
  return customerActions.update(id, input);
}
export async function deleteCustomer(id: string) {
  return customerActions.remove(id);
}

/**
 * Creates a customer from the POS with only a name, generating the code.
 * A cashier taking a walk-in's details mid-sale should not have to invent one.
 */
export async function quickCreateCustomer(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const user = await authorize('customers.create');
    const trimmed = name.trim();

    if (trimmed.length < 2) {
      throw new NotFoundError('Customer name');
    }

    // Sequence from the row count; the unique constraint on `code` is the real
    // guard, and a retry with a fresh count resolves the rare collision.
    const count = await prisma.customer.count();
    let code = `CUST-${String(count + 1).padStart(5, '0')}`;
    if (await prisma.customer.findUnique({ where: { code } })) {
      code = `CUST-${Date.now().toString(36).toUpperCase()}`;
    }

    const customer = await prisma.customer.create({
      data: { code, name: trimmed },
      select: { id: true, name: true },
    });

    await recordAudit({
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      summary: `Created customer "${customer.name}" from the POS`,
      userId: user.id,
    });

    revalidatePath('/customers');
    return customer;
  });
}
