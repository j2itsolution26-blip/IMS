import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, Package, Pencil } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getProduct, getProductHistory } from '@/features/products/queries';
import { getCurrency } from '@/server/services/settings-service';
import { toNum } from '@/lib/decimal';
import { formatCurrency, formatDateTime, formatQuantity, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  return { title: product?.name ?? 'Product' };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('products.view');
  const { id } = await params;

  const [product, currency] = await Promise.all([getProduct(id), getCurrency()]);
  if (!product) notFound();

  const history = await getProductHistory(id);

  const onHand = product.inventory.reduce((acc, row) => acc + toNum(row.quantity), 0);
  const reserved = product.inventory.reduce((acc, row) => acc + toNum(row.reserved), 0);
  const available = onHand - reserved;
  const costPrice = toNum(product.costPrice);
  const sellingPrice = toNum(product.sellingPrice);
  const reorderLevel = toNum(product.reorderLevel) || toNum(product.minStock);
  const margin = sellingPrice > 0 ? ((sellingPrice - costPrice) / sellingPrice) * 100 : 0;

  const stockTone =
    available <= 0 ? 'destructive' : reorderLevel > 0 && available <= reorderLevel ? 'warning' : 'success';

  return (
    <>
      <PageHeader
        title={product.name}
        description={`${product.sku}${product.barcode ? ` · ${product.barcode}` : ''} · ${product.category.name}`}
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: product.name }]}
        actions={
          userCan(user, 'products.update') && (
            <Button asChild>
              <Link href={`/products/${product.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Available"
          value={product.isTrackable ? formatQuantity(available) : 'Not tracked'}
          tone={stockTone}
          icon={Package}
          hint={
            product.isTrackable
              ? reserved > 0
                ? `${formatQuantity(onHand)} on hand · ${formatQuantity(reserved)} reserved`
                : reorderLevel > 0
                  ? `Reorder at ${formatQuantity(reorderLevel)}`
                  : 'No reorder level set'
              : 'Service or fee item'
          }
        />
        <StatCard
          label="Stock value"
          value={formatCurrency(onHand * costPrice, currency)}
          hint={`at ${formatCurrency(costPrice, currency)} average cost`}
        />
        <StatCard
          label="Margin"
          value={sellingPrice > 0 ? `${margin.toFixed(1)}%` : '—'}
          tone={margin < 0 ? 'destructive' : margin < 10 ? 'warning' : 'success'}
          hint={`${formatCurrency(sellingPrice - costPrice, currency)} per unit`}
        />
        <StatCard
          label={`Sold (${history.performance.windowDays}d)`}
          value={formatQuantity(history.performance.unitsSold)}
          hint={
            history.performance.unitsSold > 0
              ? `${formatCurrency(history.performance.revenue, currency)} revenue`
              : 'No sales in this window'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex h-40 items-center justify-center overflow-hidden rounded-md border bg-muted">
                {product.imageUrl ? (
                  <Image
                    src={product.imageUrl}
                    alt=""
                    width={400}
                    height={160}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Package className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                )}
              </div>

              <dl className="space-y-2 text-sm">
                <Row label="Status">
                  <Badge
                    variant={
                      product.status === 'ACTIVE'
                        ? 'success'
                        : product.status === 'INACTIVE'
                          ? 'secondary'
                          : 'destructive'
                    }
                  >
                    {humanizeEnum(product.status)}
                  </Badge>
                </Row>
                <Row label="Category">{product.category.name}</Row>
                <Row label="Brand">{product.brand?.name ?? '—'}</Row>
                <Row label="Unit">
                  {product.unit.name} ({product.unit.abbreviation})
                </Row>
                <Row label="Supplier">
                  {product.supplier ? (
                    <Link href={`/suppliers/${product.supplier.id}`} className="hover:underline">
                      {product.supplier.name}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Cost price">{formatCurrency(costPrice, currency)}</Row>
                <Row label="Selling price">{formatCurrency(sellingPrice, currency)}</Row>
                <Row label="Tax rate">{toNum(product.taxRate)}%</Row>
              </dl>

              {product.description && (
                <p className="border-t pt-3 text-sm text-muted-foreground">{product.description}</p>
              )}
            </CardContent>
          </Card>

          {product.isTrackable && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Stock by warehouse</CardTitle>
              </CardHeader>
              <CardContent>
                {product.inventory.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No stock recorded in any warehouse yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {product.inventory.map((row) => (
                      <li key={row.warehouse.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-muted-foreground">{row.warehouse.name}</span>
                        <span className="tabular shrink-0 font-medium">
                          {formatQuantity(toNum(row.quantity) - toNum(row.reserved))}
                          {toNum(row.reserved) > 0 && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              ({formatQuantity(toNum(row.reserved))} reserved)
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {history.priceHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Price changes</CardTitle>
                <CardDescription>Most recent first.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {history.priceHistory.map((change) => (
                    <li key={change.id} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {change.field === 'COST' ? 'Cost' : 'Selling'}
                        <span className="ml-1 text-xs">{formatDateTime(change.createdAt)}</span>
                      </span>
                      <span className="tabular shrink-0">
                        {formatCurrency(change.oldValue, currency)}
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span
                          className={cn(
                            'font-medium',
                            change.newValue > change.oldValue ? 'text-warning' : 'text-success',
                          )}
                        >
                          {formatCurrency(change.newValue, currency)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Stock movements</CardTitle>
            <CardDescription>Every change to this product&apos;s stock, newest first.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {history.movements.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No movements yet"
                description="Receiving stock, selling, adjusting, or transferring this product will all appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="hidden lg:table-cell">By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.movements.map((movement) => {
                    const inbound = movement.quantity > 0;
                    return (
                      <TableRow key={movement.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(movement.createdAt)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm">
                            {inbound ? (
                              <ArrowDownLeft className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                            ) : (
                              <ArrowUpRight className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                            )}
                            {humanizeEnum(movement.type)}
                          </span>
                          {movement.note && (
                            <span className="block truncate text-xs text-muted-foreground">{movement.note}</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {movement.warehouseName}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'tabular text-right font-medium',
                            inbound ? 'text-success' : 'text-destructive',
                          )}
                        >
                          {inbound ? '+' : ''}
                          {formatQuantity(movement.quantity)}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatQuantity(movement.balanceAfter)}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                          {movement.userName}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{children}</dd>
    </div>
  );
}
