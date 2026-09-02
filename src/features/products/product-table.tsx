'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductStatus } from '@prisma/client';
import type { ProductListRow } from '@/features/products/queries';
import { ProductImage } from '@/components/product-image';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { archiveProductAction, deleteProduct } from '@/features/products/actions';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_VARIANT: Record<ProductStatus, 'success' | 'secondary' | 'destructive'> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  ARCHIVED: 'destructive',
};

export function ProductTable({
  rows,
  currency,
  canUpdate,
  canDelete,
}: {
  rows: ProductListRow[];
  currency: string;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = React.useState<ProductListRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const onDelete = async () => {
    if (!target) return;
    setDeleting(true);

    const result = await deleteProduct(target.id);
    setDeleting(false);

    if (!result.ok) {
      // Trading history and remaining stock both block deletion; the service
      // explains which, so surface that verbatim rather than a generic failure.
      toast.error(result.error, { duration: 8000 });
      setTarget(null);
      return;
    }

    toast.success(`${target.name} deleted.`);
    setTarget(null);
    router.refresh();
  };

  const onArchive = async (row: ProductListRow) => {
    const result = await archiveProductAction(row.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${row.name} archived.`);
    router.refresh();
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Margin</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const belowReorder = row.isTrackable && row.reorderLevel > 0 && row.onHand <= row.reorderLevel;

            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <ProductImage src={row.imageUrl} alt={row.name} size="sm" />
                    <div className="min-w-0">
                      <Link href={`/products/${row.id}`} className="block truncate font-medium hover:underline">
                        {row.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{row.sku}</p>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="hidden md:table-cell">
                  <span className="text-sm text-muted-foreground">{row.categoryName}</span>
                </TableCell>

                <TableCell className="tabular text-right">{formatCurrency(row.costPrice, currency)}</TableCell>
                <TableCell className="tabular text-right font-medium">
                  {formatCurrency(row.sellingPrice, currency)}
                </TableCell>

                <TableCell className="hidden text-right sm:table-cell">
                  <span
                    className={cn(
                      'tabular text-sm',
                      row.marginPercent < 0
                        ? 'text-destructive'
                        : row.marginPercent < 10
                          ? 'text-warning'
                          : 'text-muted-foreground',
                    )}
                  >
                    {row.marginPercent.toFixed(1)}%
                  </span>
                </TableCell>

                <TableCell className="text-right">
                  {row.isTrackable ? (
                    <span
                      className={cn(
                        'tabular font-medium',
                        row.onHand <= 0 ? 'text-destructive' : belowReorder ? 'text-warning' : '',
                      )}
                    >
                      {formatQuantity(row.onHand)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {row.unitAbbreviation}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">not tracked</span>
                  )}
                </TableCell>

                <TableCell>
                  <Badge variant={STATUS_VARIANT[row.status]}>
                    {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                  </Badge>
                </TableCell>

                <TableCell>
                  {(canUpdate || canDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${row.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canUpdate && (
                          <DropdownMenuItem asChild>
                            <Link href={`/products/${row.id}/edit`}>
                              <Pencil /> Edit
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {canUpdate && row.status !== 'ARCHIVED' && (
                          <DropdownMenuItem onSelect={() => onArchive(row)}>
                            <Archive /> Archive
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem destructive onSelect={() => setTarget(row)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`Delete ${target?.name ?? 'product'}?`}
        description="This cannot be undone. Products with sales or purchase history cannot be deleted — discontinue them instead so past reports stay accurate."
        confirmLabel="Delete product"
        loading={deleting}
        onConfirm={onDelete}
      />
    </>
  );
}
