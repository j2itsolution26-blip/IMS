'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Banknote,
  CreditCard,
  Loader2,
  Lock,
  LogOut,
  Minus,
  Package,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentMethod } from '@prisma/client';
import type { SellableProduct } from '@/features/products/queries';
import { ProductImage } from '@/components/product-image';
import { checkout, lookupProducts } from '@/features/pos/actions';
import { openShiftAction, closeShiftAction, previewShiftCloseAction } from '@/features/pos/shift-actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/misc';
import { Receipt, type ReceiptData } from '@/features/pos/receipt';
import { formatCurrency, formatDateTime, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The till.
 *
 * Totals are computed locally for instant feedback, then recomputed on the
 * server from catalogue prices at checkout — the client figure is a preview,
 * never the source of truth. If the two ever disagree, the server wins and the
 * receipt shows the server's numbers.
 *
 * Every sale is a walk-in sale — there is no customer to pick — and checkout
 * requires an open cashier shift.
 */

export interface OpenShiftInfo {
  id: string;
  openedAt: string;
  openingCash: number;
}

export interface PosTerminalProps {
  initialProducts: SellableProduct[];
  currency: string;
  taxRate: number;
  company: {
    name: string;
    address: string;
    phone: string;
    receiptFooter: string;
  };
  cashierName: string;
  openShift: OpenShiftInfo | null;
}

interface BasketLine {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  available: number;
  isTrackable: boolean;
  allowDecimal: boolean;
  unitAbbreviation: string;
}

interface TenderRow {
  method: PaymentMethod;
  amount: string;
  reference: string;
}

const METHOD_META: Record<PaymentMethod, { label: string; icon: typeof Banknote }> = {
  CASH: { label: 'Cash', icon: Banknote },
  GCASH: { label: 'GCash', icon: Smartphone },
  CARD: { label: 'Card', icon: CreditCard },
  OTHER: { label: 'Other', icon: CreditCard },
};

const QUICK_METHODS: PaymentMethod[] = ['CASH', 'GCASH', 'CARD', 'OTHER'];

export function PosTerminal({
  initialProducts,
  currency,
  taxRate,
  company,
  cashierName,
  openShift,
}: PosTerminalProps) {
  const router = useRouter();

  const [term, setTerm] = React.useState('');
  const [products, setProducts] = React.useState(initialProducts);
  const [searching, setSearching] = React.useState(false);

  const [basket, setBasket] = React.useState<BasketLine[]>([]);
  const [orderDiscount, setOrderDiscount] = React.useState('0');
  const [notes, setNotes] = React.useState('');

  const [payOpen, setPayOpen] = React.useState(false);
  const [tenders, setTenders] = React.useState<TenderRow[]>([{ method: 'CASH', amount: '', reference: '' }]);
  const [submitting, setSubmitting] = React.useState(false);

  const [receipt, setReceipt] = React.useState<ReceiptData | null>(null);

  // --- Shift -----------------------------------------------------------------

  const [openingCash, setOpeningCash] = React.useState('');
  const [openingShift, setOpeningShift] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [closePreview, setClosePreview] = React.useState<{
    openingCash: number;
    expectedCash: number;
    totalSales: number;
    transactionCount: number;
  } | null>(null);
  const [actualCash, setActualCash] = React.useState('');
  const [closing, setClosing] = React.useState(false);
  const [closeSummary, setCloseSummary] = React.useState<{
    expectedCash: number;
    actualCash: number;
    difference: number;
    totalSales: number;
    transactionCount: number;
  } | null>(null);

  const onOpenShift = async () => {
    const amount = Number(openingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid opening cash amount.');
      return;
    }
    setOpeningShift(true);
    const result = await openShiftAction({ openingCash: amount });
    setOpeningShift(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Shift opened.');
    router.refresh();
  };

  const openCloseDialog = async () => {
    setCloseOpen(true);
    setClosePreview(null);
    const result = await previewShiftCloseAction();
    if (result.ok) {
      setClosePreview(result.data);
      setActualCash(result.data.expectedCash.toFixed(2));
    }
  };

  const onCloseShift = async () => {
    const amount = Number(actualCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid counted cash amount.');
      return;
    }
    setClosing(true);
    const result = await closeShiftAction({ actualCash: amount });
    setClosing(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setCloseSummary(result.data);
  };

  const onCloseSummaryDone = () => {
    setCloseOpen(false);
    setCloseSummary(null);
    router.refresh();
  };

  // --- Product lookup ------------------------------------------------------

  const runLookup = React.useCallback(async (value: string) => {
    setSearching(true);
    const result = await lookupProducts(value);
    setSearching(false);
    if (result.ok) setProducts(result.data);
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => void runLookup(term), 250);
    return () => clearTimeout(timer);
  }, [term, runLookup]);

  // F2 jumps to the search/scan field from anywhere on the page.
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Basket --------------------------------------------------------------

  const addToBasket = React.useCallback((product: SellableProduct, quantity = 1) => {
    setBasket((current) => {
      const existing = current.find((line) => line.productId === product.id);

      if (existing) {
        const next = existing.quantity + quantity;
        if (product.isTrackable && next > product.available) {
          toast.warning(`Only ${formatQuantity(product.available)} of ${product.name} available.`);
          return current;
        }
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: next } : line,
        );
      }

      if (product.isTrackable && product.available < quantity) {
        toast.warning(`${product.name} is out of stock.`);
        return current;
      }

      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: product.sellingPrice,
          quantity,
          discount: 0,
          available: product.available,
          isTrackable: product.isTrackable,
          allowDecimal: product.allowDecimal,
          unitAbbreviation: product.unitAbbreviation,
        },
      ];
    });
  }, []);

  /** Enter in the search field: an exact barcode match rings straight through. */
  const onSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = term.trim();
    if (!value) return;

    const exact =
      products.find((p) => p.barcode && p.barcode.toLowerCase() === value.toLowerCase()) ??
      products.find((p) => p.sku.toLowerCase() === value.toLowerCase());

    if (exact) {
      addToBasket(exact);
      setTerm('');
      return;
    }

    if (products.length === 1) {
      addToBasket(products[0]);
      setTerm('');
    }
  };

  const setQuantity = (productId: string, quantity: number) => {
    setBasket((current) =>
      current.flatMap((line) => {
        if (line.productId !== productId) return [line];
        if (quantity <= 0) return [];
        if (line.isTrackable && quantity > line.available) {
          toast.warning(`Only ${formatQuantity(line.available)} available.`);
          return [{ ...line, quantity: line.available }];
        }
        return [{ ...line, quantity }];
      }),
    );
  };

  const setLineDiscount = (productId: string, discount: number) => {
    setBasket((current) =>
      current.map((line) => {
        if (line.productId !== productId) return line;
        const max = line.unitPrice * line.quantity;
        return { ...line, discount: Math.min(Math.max(0, discount), max) };
      }),
    );
  };

  const clearBasket = () => {
    setBasket([]);
    setOrderDiscount('0');
    setNotes('');
  };

  // --- Totals (preview only; the server recomputes at checkout) ------------

  const totals = React.useMemo(() => {
    let subtotal = 0;

    for (const line of basket) {
      subtotal += line.unitPrice * line.quantity - line.discount;
    }

    const discount = Math.min(Math.max(0, Number(orderDiscount) || 0), subtotal);
    const taxable = subtotal - discount;
    const tax = round((taxable * taxRate) / 100);

    return {
      subtotal: round(subtotal),
      tax,
      discount: round(discount),
      total: round(taxable + tax),
      itemCount: basket.reduce((acc, line) => acc + line.quantity, 0),
    };
  }, [basket, orderDiscount, taxRate]);

  const tendered = tenders.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
  const hasCash = tenders.some((row) => row.method === 'CASH' && Number(row.amount) > 0);
  const change = hasCash ? Math.max(0, round(tendered - totals.total)) : 0;
  const outstanding = round(Math.max(0, totals.total - tendered));

  // --- Checkout ------------------------------------------------------------

  const openPayment = () => {
    if (basket.length === 0) return;
    // Pre-fill exact cash: the common case is a card or e-wallet for the exact
    // amount, and typing it again is friction.
    setTenders([{ method: 'CASH', amount: totals.total.toFixed(2), reference: '' }]);
    setPayOpen(true);
  };

  const onCheckout = async () => {
    if (outstanding > 0) {
      toast.error('Amount tendered does not cover the total.');
      return;
    }

    setSubmitting(true);

    const result = await checkout({
      items: basket.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discount: line.discount,
      })),
      discount: Number(orderDiscount) || 0,
      payments: tenders
        .filter((row) => Number(row.amount) > 0)
        .map((row) => ({
          method: row.method,
          amount: Number(row.amount),
          reference: row.reference.trim() || undefined,
        })),
      notes: notes.trim() || undefined,
    });

    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    // The receipt is built from the server's figures, not the local preview.
    setReceipt({
      invoiceNumber: result.data.invoiceNumber,
      issuedAt: new Date(),
      cashierName,
      lines: basket.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        total: round(line.unitPrice * line.quantity - line.discount),
      })),
      subtotal: totals.subtotal,
      tax: totals.tax,
      discount: totals.discount,
      total: result.data.total,
      paid: result.data.paidAmount,
      change: result.data.changeAmount,
      payments: tenders
        .filter((row) => Number(row.amount) > 0)
        .map((row) => ({ method: METHOD_META[row.method].label, amount: Number(row.amount) })),
      company,
      currency,
    });

    setPayOpen(false);
    clearBasket();
    void runLookup(term);
    router.refresh();
  };

  // --- No open shift: block the till entirely -------------------------------

  if (!openShift) {
    return (
      <Card className="mx-auto max-w-sm p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="font-medium">Open your shift to start selling</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Count the cash in the drawer and enter it below.
        </p>
        <div className="mt-4 space-y-2 text-left">
          <Label htmlFor="opening-cash">Opening cash</Label>
          <Input
            id="opening-cash"
            type="number"
            min={0}
            step="0.01"
            value={openingCash}
            onChange={(event) => setOpeningCash(event.target.value)}
            placeholder="0.00"
            onKeyDown={(e) => e.key === 'Enter' && onOpenShift()}
            autoFocus
          />
        </div>
        <Button className="mt-4 w-full" size="lg" loading={openingShift} onClick={onOpenShift}>
          Open shift
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* Product picker */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <span>Shift open since {formatDateTime(new Date(openShift.openedAt))}</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={openCloseDialog}>
            <LogOut className="h-3.5 w-3.5" /> Close shift
          </Button>
        </div>

        <form onSubmit={onSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Scan a barcode or search by name / SKU… (F2)"
              className="pl-8"
              autoFocus
              autoComplete="off"
              aria-label="Scan or search products"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        </form>

        {products.length === 0 ? (
          <Card className="p-10 text-center">
            <Package className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
            <p className="text-sm font-medium">No products found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {term
                ? `Nothing matches “${term}”.`
                : 'Add active products to your catalogue to sell them here.'}
            </p>
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => {
              const soldOut = product.isTrackable && product.available <= 0;

              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => addToBasket(product)}
                    disabled={soldOut}
                    className={cn(
                      'flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors',
                      soldOut
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:border-primary/50 hover:bg-accent/40',
                    )}
                  >
                    <span className="flex h-20 w-full items-center justify-center">
                      <ProductImage
                        src={product.imageUrl}
                        alt={product.name}
                        size="fill"
                        className="rounded-none border-0"
                      />
                    </span>
                    <span className="flex flex-1 flex-col gap-0.5 p-2.5">
                      <span className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</span>
                      <span className="text-xs text-muted-foreground">{product.sku}</span>
                      <span className="mt-auto flex items-center justify-between gap-1 pt-1.5">
                        <span className="tabular text-sm font-semibold">
                          {formatCurrency(product.sellingPrice, currency)}
                        </span>
                        {product.isTrackable ? (
                          <Badge
                            variant={
                              soldOut ? 'destructive' : product.available <= 5 ? 'warning' : 'secondary'
                            }
                          >
                            {soldOut ? 'Out' : formatQuantity(product.available)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Service</Badge>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Basket */}
      <Card className="flex h-fit flex-col lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-6rem)]">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <p className="flex items-center gap-1.5 font-semibold">
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            Current sale
            {totals.itemCount > 0 && (
              <Badge variant="default">{formatQuantity(totals.itemCount)}</Badge>
            )}
          </p>
          {basket.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearBasket} className="h-7 text-xs">
              <X /> Clear
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {basket.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <ShoppingCart className="mx-auto mb-2 h-7 w-7 text-muted-foreground/30" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Scan or tap a product to start.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {basket.map((line) => (
                <li key={line.productId} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatCurrency(line.unitPrice, currency)} × {formatQuantity(line.quantity)}{' '}
                        {line.unitAbbreviation}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.productId, 0)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setQuantity(line.productId, line.quantity - 1)}
                      aria-label={`Decrease ${line.name}`}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      value={line.quantity}
                      min={0}
                      step={line.allowDecimal ? 0.001 : 1}
                      onChange={(event) => setQuantity(line.productId, Number(event.target.value))}
                      className="h-7 w-16 text-center"
                      aria-label={`Quantity for ${line.name}`}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setQuantity(line.productId, line.quantity + 1)}
                      aria-label={`Increase ${line.name}`}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>

                    <Input
                      type="number"
                      value={line.discount || ''}
                      min={0}
                      step="0.01"
                      placeholder="Disc."
                      onChange={(event) => setLineDiscount(line.productId, Number(event.target.value))}
                      className="h-7 w-20 text-right"
                      aria-label={`Discount for ${line.name}`}
                    />

                    <span className="tabular ml-auto text-sm font-semibold">
                      {formatCurrency(line.unitPrice * line.quantity - line.discount, currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t p-3">
          <Row label="Subtotal" value={formatCurrency(totals.subtotal, currency)} />
          {totals.tax > 0 && <Row label="Tax" value={formatCurrency(totals.tax, currency)} />}

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="order-discount" className="text-sm font-normal text-muted-foreground">
              Discount
            </Label>
            <Input
              id="order-discount"
              type="number"
              min={0}
              step="0.01"
              value={orderDiscount}
              onChange={(event) => setOrderDiscount(event.target.value)}
              className="h-7 w-24 text-right"
            />
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <span className="font-semibold">Total</span>
            <span className="tabular text-xl font-bold">{formatCurrency(totals.total, currency)}</span>
          </div>

          <Button className="w-full" size="lg" disabled={basket.length === 0} onClick={openPayment}>
            Take payment
          </Button>
        </div>
      </Card>

      {/* Payment */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Take payment</DialogTitle>
            <DialogDescription>
              {formatCurrency(totals.total, currency)} due for {formatQuantity(totals.itemCount)} item
              {totals.itemCount === 1 ? '' : 's'}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_METHODS.map((method) => {
                const Icon = METHOD_META[method].icon;
                return (
                  <Button
                    key={method}
                    type="button"
                    variant={tenders[0]?.method === method ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      setTenders([
                        { method, amount: totals.total.toFixed(2), reference: '' },
                      ])
                    }
                  >
                    <Icon /> {METHOD_META[method].label}
                  </Button>
                );
              })}
            </div>

            {tenders.map((tender, index) => (
              <div key={index} className="space-y-2 rounded-md border p-2.5">
                <div className="flex gap-2">
                  <Select
                    value={tender.method}
                    onValueChange={(value) =>
                      setTenders((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, method: value as PaymentMethod } : row,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="w-[150px]" aria-label="Payment method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(METHOD_META).map(([value, meta]) => (
                        <SelectItem key={value} value={value}>
                          {meta.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={tender.amount}
                    onChange={(event) =>
                      setTenders((current) =>
                        current.map((row, i) => (i === index ? { ...row, amount: event.target.value } : row)),
                      )
                    }
                    placeholder="0.00"
                    className="text-right"
                    aria-label="Amount tendered"
                  />

                  {tenders.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTenders((current) => current.filter((_, i) => i !== index))}
                      aria-label="Remove payment line"
                    >
                      <X />
                    </Button>
                  )}
                </div>

                {tender.method !== 'CASH' && (
                  <Input
                    value={tender.reference}
                    onChange={(event) =>
                      setTenders((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, reference: event.target.value } : row,
                        ),
                      )
                    }
                    placeholder="Reference number (optional)"
                    aria-label="Payment reference"
                  />
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                setTenders((current) => [
                  ...current,
                  { method: 'CASH', amount: outstanding > 0 ? outstanding.toFixed(2) : '', reference: '' },
                ])
              }
            >
              <Plus /> Split payment
            </Button>

            <Separator />

            <Row label="Tendered" value={formatCurrency(tendered, currency)} />
            {change > 0 && (
              <div className="flex items-center justify-between rounded-md bg-success/10 px-3 py-2">
                <span className="font-medium text-success">Change</span>
                <span className="tabular text-lg font-bold text-success">
                  {formatCurrency(change, currency)}
                </span>
              </div>
            )}
            {outstanding > 0 && (
              <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2">
                <span className="font-medium text-destructive">Still due</span>
                <span className="tabular font-bold text-destructive">
                  {formatCurrency(outstanding, currency)}
                </span>
              </div>
            )}

            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Notes for this sale (optional)"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={onCheckout} loading={submitting}>
              Complete sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt */}
      <Dialog open={receipt !== null} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="no-print">
            <DialogTitle>Sale complete</DialogTitle>
            <DialogDescription>{receipt?.invoiceNumber}</DialogDescription>
          </DialogHeader>

          {receipt && <Receipt data={receipt} />}

          <DialogFooter className="no-print">
            <Button variant="outline" onClick={() => setReceipt(null)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>
              <Printer /> Print receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close shift */}
      <Dialog open={closeOpen} onOpenChange={(open) => !open && !closing && setCloseOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{closeSummary ? 'Shift closed' : 'Close shift'}</DialogTitle>
          </DialogHeader>

          {closeSummary ? (
            <div className="space-y-2">
              <Row label="Total sales" value={formatCurrency(closeSummary.totalSales, currency)} />
              <Row label="Transactions" value={String(closeSummary.transactionCount)} />
              <Row label="Expected cash" value={formatCurrency(closeSummary.expectedCash, currency)} />
              <Row label="Actual cash" value={formatCurrency(closeSummary.actualCash, currency)} />
              <Separator />
              <div className="flex items-center justify-between">
                <span className="font-semibold">Difference</span>
                <span
                  className={cn(
                    'tabular text-lg font-bold',
                    closeSummary.difference === 0
                      ? 'text-success'
                      : closeSummary.difference > 0
                        ? 'text-success'
                        : 'text-destructive',
                  )}
                >
                  {closeSummary.difference > 0 ? '+' : ''}
                  {formatCurrency(closeSummary.difference, currency)}
                </span>
              </div>
            </div>
          ) : closePreview ? (
            <div className="space-y-3">
              <Row label="Opening cash" value={formatCurrency(closePreview.openingCash, currency)} />
              <Row label="Total sales" value={formatCurrency(closePreview.totalSales, currency)} />
              <Row label="Transactions" value={String(closePreview.transactionCount)} />
              <Row label="Expected cash" value={formatCurrency(closePreview.expectedCash, currency)} />
              <div className="space-y-1.5">
                <Label htmlFor="actual-cash">Actual cash counted</Label>
                <Input
                  id="actual-cash"
                  type="number"
                  min={0}
                  step="0.01"
                  value={actualCash}
                  onChange={(event) => setActualCash(event.target.value)}
                  autoFocus
                />
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          )}

          <DialogFooter>
            {closeSummary ? (
              <Button onClick={onCloseSummaryDone}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setCloseOpen(false)} disabled={closing}>
                  Cancel
                </Button>
                <Button onClick={onCloseShift} loading={closing} disabled={!closePreview}>
                  Close shift
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}

/** Keeps the running preview free of floating-point drift. */
function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
