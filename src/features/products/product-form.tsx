'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { productSchema, PRODUCT_STATUS_OPTIONS, type ProductInput } from '@/features/products/schema';
import { createProduct, updateProduct, uploadProductImageAction } from '@/features/products/actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/misc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, FormError, applyServerErrors } from '@/components/form';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/format';
import { ProductImage } from '@/components/product-image';
import { validateImageUrl } from '@/lib/image-url';

export interface ProductFormOptions {
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  units: { id: string; name: string; abbreviation: string }[];
  suppliers: { id: string; name: string }[];
}

export interface ProductFormProps {
  options: ProductFormOptions;
  currency: string;
  storageEnabled: boolean;
  /** Present when editing. */
  productId?: string;
  defaultValues?: Partial<ProductInput>;
}

const EMPTY: ProductInput = {
  name: '',
  sku: '',
  barcode: '',
  description: '',
  imageUrl: '',
  categoryId: '',
  unitId: '',
  brandId: 'none',
  supplierId: 'none',
  costPrice: 0,
  sellingPrice: 0,
  taxRate: 0,
  minStock: 0,
  maxStock: 0,
  reorderLevel: 0,
  reorderQty: 0,
  status: 'ACTIVE',
  isTrackable: true,
};

export function ProductForm({
  options,
  currency,
  storageEnabled,
  productId,
  defaultValues,
}: ProductFormProps) {
  const router = useRouter();
  const isEdit = Boolean(productId);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: { ...EMPTY, ...defaultValues },
  });

  const imageUrl = watch('imageUrl');
  // Same rule the server applies, so the field cannot look accepted here
  // and then be rejected on submit.
  const imageCheck = React.useMemo(() => validateImageUrl(imageUrl), [imageUrl]);
  const costPrice = Number(watch('costPrice')) || 0;
  const sellingPrice = Number(watch('sellingPrice')) || 0;
  const isTrackable = watch('isTrackable');

  // Live margin so the user sees the consequence of a price before saving.
  const margin = sellingPrice > 0 ? ((sellingPrice - costPrice) / sellingPrice) * 100 : 0;
  const profitPerUnit = sellingPrice - costPrice;

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sku', watch('sku') || 'product');

    const result = await uploadProductImageAction(formData);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setValue('imageUrl', result.data.url, { shouldDirty: true });
    toast.success('Image uploaded.');
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = isEdit ? await updateProduct(productId!, values) : await createProduct(values);

    if (!result.ok) {
      setFormError(applyServerErrors<ProductInput>(result, setError));
      return;
    }

    toast.success(isEdit ? 'Product updated.' : 'Product created.');
    router.push(`/products/${result.data.id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
              <CardDescription>How this product is identified at the till and in reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField id="name" label="Product name" error={errors.name} required>
                <Input id="name" {...register('name')} aria-invalid={Boolean(errors.name)} autoFocus />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="sku"
                  label="SKU"
                  error={errors.sku}
                  required
                  description="Your internal code. Must be unique."
                >
                  <Input id="sku" {...register('sku')} aria-invalid={Boolean(errors.sku)} className="uppercase" />
                </FormField>

                <FormField
                  id="barcode"
                  label="Barcode"
                  error={errors.barcode}
                  description="Scanned at the POS. Leave blank if there isn't one."
                >
                  <Input id="barcode" {...register('barcode')} aria-invalid={Boolean(errors.barcode)} />
                </FormField>
              </div>

              <FormField id="description" label="Description" error={errors.description}>
                <Textarea id="description" rows={3} {...register('description')} />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pricing</CardTitle>
              <CardDescription>
                Cost is re-averaged automatically each time you receive stock at a different price.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField id="costPrice" label="Cost price" error={errors.costPrice} required>
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

                <FormField id="sellingPrice" label="Selling price" error={errors.sellingPrice} required>
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

                <FormField id="taxRate" label="Tax rate (%)" error={errors.taxRate}>
                  <Input
                    id="taxRate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    inputMode="decimal"
                    {...register('taxRate')}
                    aria-invalid={Boolean(errors.taxRate)}
                  />
                </FormField>
              </div>

              <div className="flex flex-wrap items-center gap-4 rounded-md bg-muted/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Profit per unit</span>
                <span className={`tabular font-medium ${profitPerUnit < 0 ? 'text-destructive' : ''}`}>
                  {formatCurrency(profitPerUnit, currency)}
                </span>
                <span className="text-muted-foreground">Margin</span>
                <span
                  className={`tabular font-medium ${
                    margin < 0 ? 'text-destructive' : margin < 10 ? 'text-warning' : 'text-success'
                  }`}
                >
                  {sellingPrice > 0 ? `${margin.toFixed(1)}%` : '—'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Stock control</CardTitle>
              <CardDescription>
                These thresholds drive low-stock alerts and reorder suggestions on the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div>
                  <Label htmlFor="isTrackable">Track stock levels</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Turn off for services or fees that have no physical stock.
                  </p>
                </div>
                <Controller
                  name="isTrackable"
                  control={control}
                  render={({ field }) => (
                    <Switch id="isTrackable" checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </div>

              {isTrackable && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <FormField id="minStock" label="Minimum" error={errors.minStock}>
                    <Input id="minStock" type="number" step="0.001" min="0" {...register('minStock')} />
                  </FormField>
                  <FormField id="reorderLevel" label="Reorder at" error={errors.reorderLevel}>
                    <Input id="reorderLevel" type="number" step="0.001" min="0" {...register('reorderLevel')} />
                  </FormField>
                  <FormField id="reorderQty" label="Reorder qty" error={errors.reorderQty}>
                    <Input id="reorderQty" type="number" step="0.001" min="0" {...register('reorderQty')} />
                  </FormField>
                  <FormField id="maxStock" label="Maximum" error={errors.maxStock}>
                    <Input id="maxStock" type="number" step="0.001" min="0" {...register('maxStock')} />
                  </FormField>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Organisation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField id="categoryId" label="Category" error={errors.categoryId} required>
                <Controller
                  name="categoryId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <SelectTrigger id="categoryId" aria-invalid={Boolean(errors.categoryId)}>
                        <SelectValue placeholder="Choose a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.categories.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            No categories yet — create one first.
                          </div>
                        ) : (
                          options.categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField id="unitId" label="Unit of measure" error={errors.unitId} required>
                <Controller
                  name="unitId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <SelectTrigger id="unitId" aria-invalid={Boolean(errors.unitId)}>
                        <SelectValue placeholder="Choose a unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.units.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            No units yet — create one first.
                          </div>
                        ) : (
                          options.units.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              {unit.name} ({unit.abbreviation})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField id="brandId" label="Brand" error={errors.brandId}>
                <Controller
                  name="brandId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || 'none'} onValueChange={field.onChange}>
                      <SelectTrigger id="brandId">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No brand</SelectItem>
                        {options.brands.map((brand) => (
                          <SelectItem key={brand.id} value={brand.id}>
                            {brand.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField
                id="supplierId"
                label="Default supplier"
                error={errors.supplierId}
                description="Used to group reorder suggestions."
              >
                <Controller
                  name="supplierId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || 'none'} onValueChange={field.onChange}>
                      <SelectTrigger id="supplierId">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No supplier</SelectItem>
                        {options.suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField id="status" label="Status" error={errors.status}>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCT_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Image</CardTitle>
              <CardDescription>Shown in the POS grid and product lists.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Only a URL that passes validation is previewed — otherwise a
                  rejected address would still render (and fail) below the very
                  error explaining why it is not usable. */}
              <ProductImage
                src={imageCheck.ok && imageUrl ? imageUrl : null}
                alt={watch('name') || 'Product'}
                size="lg"
                showFailureText
              />

              {/* The unavailable message below deliberately says nothing about
                  environment variables or bucket names. It is shown to whoever
                  is adding a product — usually a shop-floor user who cannot act
                  on server configuration. The administrator's version of this
                  lives in /api/health. */}
              {storageEnabled ? (
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onUpload}
                    className="hidden"
                    id="product-image"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                    {uploading ? 'Uploading…' : 'Upload'}
                  </Button>
                  {imageUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setValue('imageUrl', '', { shouldDirty: true })}
                      aria-label="Remove image"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <p className="font-medium">Image upload is temporarily unavailable</p>
                  <p className="mt-1 opacity-90">
                    You can still add a picture by pasting a direct image link below.
                  </p>
                </div>
              )}

              <FormField
                id="imageUrl"
                label="Image URL"
                error={errors.imageUrl}
                description="Must link directly to an image file, not to a page showing one."
              >
                <Input
                  id="imageUrl"
                  placeholder="https://example.com/photo.jpg"
                  aria-invalid={Boolean(imageUrl) && !imageCheck.ok}
                  {...register('imageUrl')}
                />
              </FormField>

              {/* Immediate feedback while typing, before the form is submitted. */}
              {imageUrl && !imageCheck.ok && !errors.imageUrl && (
                <p className="text-xs text-destructive">{imageCheck.reason}</p>
              )}

              <p className="text-xs text-muted-foreground">
                Supported formats: JPG, PNG, WEBP · Maximum size: 5 MB
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" asChild>
          <Link href={productId ? `/products/${productId}` : '/products'}>Cancel</Link>
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  );
}
