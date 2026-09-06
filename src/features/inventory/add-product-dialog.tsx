'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createProduct } from '@/features/products/actions';
import { stockInAction } from '@/features/inventory/actions';
import { createCategory } from '@/features/catalogue/actions';
import type { ProductInput } from '@/features/products/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormError } from '@/components/form';
import { BarcodeScanButton } from '@/features/inventory/barcode-scan-button';

const quickAddSchema = z.object({
  name: z.string().trim().min(2, 'Give the product a name.').max(160),
  sellingPrice: z.coerce
    .number({ invalid_type_error: 'Enter a price.' })
    .positive('Enter a price greater than zero.'),
  costPrice: z.coerce.number({ invalid_type_error: 'Enter a number.' }).min(0, 'Cannot be negative.'),
  stock: z.coerce.number({ invalid_type_error: 'Enter a number.' }).min(0, 'Cannot be negative.'),
  categoryId: z.string().trim().min(1, 'Choose a category.'),
  barcode: z.string().trim().max(64),
});

type QuickAddInput = z.input<typeof quickAddSchema>;

const EMPTY: QuickAddInput = {
  name: '',
  sellingPrice: 0,
  costPrice: 0,
  stock: 0,
  categoryId: '',
  barcode: '',
};

/** Turns a product name into a unique-enough SKU without asking the owner to think about one. */
function generateSku(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = Date.now().toString(36).toUpperCase();
  return `${base || 'ITEM'}-${suffix}`;
}

export function AddProductDialog({
  categories,
  defaultUnitId,
  defaultReorderLevel,
}: {
  categories: { id: string; name: string }[];
  defaultUnitId: string;
  defaultReorderLevel: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = React.useState(categories);
  const [addingCategory, setAddingCategory] = React.useState(false);
  const [newCategoryName, setNewCategoryName] = React.useState('');
  const [savingCategory, setSavingCategory] = React.useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<QuickAddInput>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: { ...EMPTY, categoryId: categories[0]?.id ?? '' },
  });

  React.useEffect(() => {
    if (open) {
      reset({ ...EMPTY, categoryId: categoryOptions[0]?.id ?? '' });
      setFormError(null);
      setAddingCategory(false);
      setNewCategoryName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSaveCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (trimmed.length < 2) {
      toast.error('Category name must be at least 2 characters.');
      return;
    }

    setSavingCategory(true);
    const result = await createCategory({ name: trimmed, description: '', parentId: 'none', isActive: true });
    setSavingCategory(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setCategoryOptions((prev) => [...prev, { id: result.data.id, name: trimmed }]);
    setValue('categoryId', result.data.id, { shouldValidate: true });
    setNewCategoryName('');
    setAddingCategory(false);
    toast.success('Category added.');
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    if (!defaultUnitId) {
      setFormError('Add a unit of measure first — see More → Categories & units.');
      return;
    }

    const payload: ProductInput = {
      name: values.name,
      sku: generateSku(values.name),
      barcode: values.barcode?.trim() || '',
      description: '',
      imageUrl: '',
      categoryId: values.categoryId,
      unitId: defaultUnitId,
      costPrice: values.costPrice || 0,
      sellingPrice: values.sellingPrice,
      minStock: 0,
      maxStock: 0,
      reorderLevel: defaultReorderLevel,
      reorderQty: 0,
      status: 'ACTIVE',
      isTrackable: true,
    };

    const result = await createProduct(payload);
    if (!result.ok) {
      const visibleFields: (keyof QuickAddInput)[] = ['name', 'sellingPrice', 'costPrice', 'categoryId', 'barcode'];
      const entries = Object.entries(result.fieldErrors ?? {}).filter(([field]) =>
        visibleFields.includes(field as keyof QuickAddInput),
      );

      if (entries.length > 0) {
        for (const [field, messages] of entries) {
          if (messages?.[0]) setError(field as keyof QuickAddInput, { type: 'server', message: messages[0] });
        }
      } else {
        setFormError(result.error);
      }
      return;
    }

    const stockQty = Number(values.stock) || 0;
    if (stockQty > 0) {
      const stockResult = await stockInAction({ productId: result.data.id, quantity: stockQty });
      if (!stockResult.ok) {
        toast.error(`Product added, but stock could not be set: ${stockResult.error}`, { duration: 8000 });
        setOpen(false);
        router.refresh();
        return;
      }
    }

    toast.success(`${values.name} added.`);
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Plus /> Add Product
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Product</DialogTitle>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormError message={formError} />

            <FormField id="name" label="Product Name" error={errors.name} required>
              <Input id="name" {...register('name')} aria-invalid={Boolean(errors.name)} autoFocus />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField id="sellingPrice" label="Selling Price" error={errors.sellingPrice} required>
                <Input
                  id="sellingPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  {...register('sellingPrice')}
                  aria-invalid={Boolean(errors.sellingPrice)}
                />
              </FormField>

              <FormField id="costPrice" label="Cost Price" error={errors.costPrice}>
                <Input
                  id="costPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  {...register('costPrice')}
                  aria-invalid={Boolean(errors.costPrice)}
                />
              </FormField>
            </div>

            <FormField id="stock" label="Stock" error={errors.stock} required>
              <Input
                id="stock"
                type="number"
                step="0.001"
                min="0"
                inputMode="decimal"
                {...register('stock')}
                aria-invalid={Boolean(errors.stock)}
              />
            </FormField>

            <FormField id="categoryId" label="Category" error={errors.categoryId} required>
              {addingCategory ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="e.g. Snacks"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onSaveCategory())}
                  />
                  <Button type="button" loading={savingCategory} onClick={onSaveCategory}>
                    Add
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setAddingCategory(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Controller
                    name="categoryId"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || ''} onValueChange={field.onChange}>
                        <SelectTrigger id="categoryId" aria-invalid={Boolean(errors.categoryId)}>
                          <SelectValue placeholder="Choose a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions.length === 0 ? (
                            <div className="px-2 py-3 text-xs text-muted-foreground">No categories yet.</div>
                          ) : (
                            categoryOptions.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setAddingCategory(true)}
                    aria-label="Add category"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </FormField>

            <FormField
              id="barcode"
              label="Barcode"
              error={errors.barcode}
              description="Optional. Leave blank if this product doesn't have one."
            >
              <Controller
                name="barcode"
                control={control}
                render={({ field }) => (
                  <div className="flex gap-2">
                    <Input id="barcode" {...field} aria-invalid={Boolean(errors.barcode)} />
                    <BarcodeScanButton onScan={(code) => field.onChange(code)} />
                  </div>
                )}
              />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Save Product
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
