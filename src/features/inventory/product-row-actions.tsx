'use client';

import * as React from 'react';
import Link from 'next/link';
import { ClipboardEdit, History, MoreHorizontal, PackagePlus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StockInDialog } from '@/features/inventory/stock-in-dialog';
import { CorrectStockDialog } from '@/features/inventory/correct-stock-dialog';

type ActiveDialog = 'add-stock' | 'correct-stock' | null;

/** The "⋯" menu on a product row — only the actions an owner actually needs. */
export function ProductRowActions({
  productId,
  productName,
  sku,
  onHand,
  unit,
  costPrice,
  canAdjustStock,
  canEditProduct,
}: {
  productId: string;
  productName: string;
  sku: string;
  onHand: number;
  unit: string;
  costPrice: number;
  canAdjustStock: boolean;
  canEditProduct: boolean;
}) {
  const [activeDialog, setActiveDialog] = React.useState<ActiveDialog>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${productName}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEditProduct && (
            <DropdownMenuItem asChild>
              <Link href={`/products/${productId}/edit`}>
                <Pencil /> Edit product
              </Link>
            </DropdownMenuItem>
          )}
          {canAdjustStock && (
            <>
              <DropdownMenuItem onSelect={() => setActiveDialog('add-stock')}>
                <PackagePlus /> Add stock
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveDialog('correct-stock')}>
                <ClipboardEdit /> Correct stock
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/inventory/movements?q=${encodeURIComponent(sku)}`}>
              <History /> View stock history
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canAdjustStock && (
        <>
          <StockInDialog
            open={activeDialog === 'add-stock'}
            onOpenChange={(open) => setActiveDialog(open ? 'add-stock' : null)}
            productId={productId}
            productName={productName}
            currentStock={onHand}
            unit={unit}
          />
          <CorrectStockDialog
            open={activeDialog === 'correct-stock'}
            onOpenChange={(open) => setActiveDialog(open ? 'correct-stock' : null)}
            productId={productId}
            productName={productName}
            currentStock={onHand}
            unit={unit}
            costPrice={costPrice}
          />
        </>
      )}
    </>
  );
}
