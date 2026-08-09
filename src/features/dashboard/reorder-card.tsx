import Link from 'next/link';
import { PackageCheck, ShoppingCart, TruckIcon } from 'lucide-react';
import type { ReorderSuggestion } from '@/server/analytics/dashboard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { formatCurrency, formatDate, formatQuantity } from '@/lib/format';

interface SupplierAlert {
  id: string;
  orderNumber: string;
  supplierName: string;
  expectedDate: Date;
  daysLate: number;
  total: number;
}

/**
 * What to buy next, and who is late delivering.
 *
 * Suggested quantities come from each product's configured reorder quantity or
 * its max-stock gap, and the days-of-cover figure from measured sales velocity.
 */
export function ReorderCard({
  suggestions,
  supplierAlerts,
  currency,
  canPurchase,
}: {
  suggestions: ReorderSuggestion[];
  supplierAlerts: SupplierAlert[];
  currency: string;
  canPurchase: boolean;
}) {
  const estimatedTotal = suggestions.reduce((acc, s) => acc + s.estimatedCost, 0);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Reorder suggestions</CardTitle>
          <CardDescription>
            {suggestions.length > 0
              ? `${suggestions.length} product${suggestions.length === 1 ? '' : 's'} at or below reorder level · ${formatCurrency(estimatedTotal, currency)} estimated`
              : 'Products at or below their reorder level.'}
          </CardDescription>
        </div>
        {canPurchase && suggestions.length > 0 && (
          <Button asChild size="sm" variant="outline">
            {/* Seeds the order with these exact suggestions and quantities. */}
            <Link href="/purchases/new?reorder=1">
              <ShoppingCart /> Create order
            </Link>
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {suggestions.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title="Nothing needs reordering"
            description="Every active product with a reorder level set is above it. Set reorder levels on products to get suggestions here."
            className="py-8"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Cover</TableHead>
                <TableHead className="text-right">Order</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Est. cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((item) => (
                <TableRow key={item.productId}>
                  <TableCell>
                    <Link href={`/products/${item.productId}`} className="font-medium hover:underline">
                      {item.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {item.sku}
                      {item.supplierName ? ` · ${item.supplierName}` : ' · no supplier set'}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatQuantity(item.available)}
                    <span className="block text-xs text-muted-foreground">
                      of {formatQuantity(item.reorderLevel)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {item.daysUntilStockout == null ? (
                      <span className="text-xs text-muted-foreground">no sales</span>
                    ) : (
                      <Badge variant={item.daysUntilStockout <= 3 ? 'destructive' : 'warning'}>
                        {item.daysUntilStockout}d
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatQuantity(item.suggestedQuantity)}
                  </TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">
                    {formatCurrency(item.estimatedCost, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {supplierAlerts.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-warning">
              <TruckIcon className="h-4 w-4" aria-hidden="true" />
              Late deliveries
            </p>
            <ul className="space-y-1.5">
              {supplierAlerts.map((alert) => (
                <li key={alert.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                  <Link href={`/purchases/${alert.id}`} className="font-medium hover:underline">
                    {alert.orderNumber}
                  </Link>
                  <span className="text-muted-foreground">
                    {alert.supplierName} · expected {formatDate(alert.expectedDate)}
                  </span>
                  <Badge variant="warning" className="ml-auto">
                    {alert.daysLate}d late
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
