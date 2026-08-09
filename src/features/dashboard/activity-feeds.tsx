import Link from 'next/link';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Receipt,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import type { PurchaseOrderStatus } from '@prisma/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { formatCurrency, formatQuantity, formatRelative, humanizeEnum } from '@/lib/format';
import { cn } from '@/lib/utils';

interface RecentSale {
  id: string;
  invoiceNumber: string;
  total: number;
  createdAt: Date;
  customerName: string;
  cashierName: string;
  itemCount: number;
}

interface RecentPurchase {
  id: string;
  orderNumber: string;
  total: number;
  status: PurchaseOrderStatus;
  createdAt: Date;
  supplierName: string;
  itemCount: number;
}

interface RecentMovement {
  id: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  createdAt: Date;
  productId: string;
  productName: string;
  sku: string;
  warehouseName: string;
  userName: string;
}

const PO_BADGE: Record<PurchaseOrderStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  DRAFT: 'secondary',
  ORDERED: 'default',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
};

export function ActivityFeeds({
  sales,
  purchases,
  movements,
  currency,
}: {
  sales: RecentSale[];
  purchases: RecentPurchase[];
  movements: RecentMovement[];
  currency: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent sales</CardTitle>
          <CardDescription>The last few completed transactions.</CardDescription>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No sales yet"
              description="Completed sales will appear here as they happen."
              className="py-6"
            />
          ) : (
            <ul className="space-y-3">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <Link href={`/sales/${sale.id}`} className="group flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success/10 text-success">
                      <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium group-hover:underline">
                        {sale.invoiceNumber}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {sale.customerName} · {sale.itemCount} item{sale.itemCount === 1 ? '' : 's'} ·{' '}
                        {formatRelative(sale.createdAt)}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm font-medium">
                      {formatCurrency(sale.total, currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent purchases</CardTitle>
          <CardDescription>Orders raised with your suppliers.</CardDescription>
        </CardHeader>
        <CardContent>
          {purchases.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No purchase orders"
              description="Raise a purchase order to start tracking incoming stock."
              className="py-6"
            />
          ) : (
            <ul className="space-y-3">
              {purchases.map((order) => (
                <li key={order.id}>
                  <Link href={`/purchases/${order.id}`} className="group flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium group-hover:underline">
                        {order.orderNumber}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {order.supplierName} · {formatRelative(order.createdAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="tabular text-sm font-medium">{formatCurrency(order.total, currency)}</span>
                      <Badge variant={PO_BADGE[order.status]} className="text-[10px]">
                        {humanizeEnum(order.status)}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stock activity</CardTitle>
          <CardDescription>Every movement, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No stock movements"
              description="Receiving stock, selling, and adjustments all appear in this ledger."
              className="py-6"
            />
          ) : (
            <ul className="space-y-3">
              {movements.map((movement) => {
                const inbound = movement.quantity > 0;
                return (
                  <li key={movement.id}>
                    <Link href={`/products/${movement.productId}`} className="group flex items-start gap-2.5">
                      <span
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          inbound ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
                        )}
                      >
                        {inbound ? (
                          <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium group-hover:underline">
                          {movement.productName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {humanizeEnum(movement.type)} · {movement.warehouseName} ·{' '}
                          {formatRelative(movement.createdAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={cn(
                            'tabular block text-sm font-medium',
                            inbound ? 'text-success' : 'text-destructive',
                          )}
                        >
                          {inbound ? '+' : ''}
                          {formatQuantity(movement.quantity)}
                        </span>
                        <span className="tabular block text-xs text-muted-foreground">
                          → {formatQuantity(movement.balanceAfter)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
