'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Banknote,
  Check,
  Copy,
  Loader2,
  Lock,
  LogOut,
  Minus,
  Package,
  Plus,
  Printer,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Smartphone,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentMethod } from '@prisma/client';
import type { PosCategoryChip, SellableProduct, SellableSort } from '@/features/products/queries';
import { normalizeBarcode } from '@/lib/barcode';
import { ProductImage } from '@/components/product-image';
import { checkout, lookupBarcode, lookupProducts } from '@/features/pos/actions';
import { openShiftAction, closeShiftAction, previewShiftCloseAction } from '@/features/pos/shift-actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { BarcodeScanButton } from '@/features/inventory/barcode-scan-button';
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
  /** Read-only at the till — only an Owner can change these, from Settings. */
  gcash: { number: string; accountName: string };
  canEditStoreSettings: boolean;
  canCreateProducts: boolean;
  categoryChips: { total: number; lowStock: number; categories: PosCategoryChip[] };
  lowStockLevel: number;
  openShift: OpenShiftInfo | null;
}

interface BasketLine {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  discount: number;
  available: number;
  isTrackable: boolean;
  allowDecimal: boolean;
  unitAbbreviation: string;
}

/**
 * A sari-sari store takes cash or GCash. The `PaymentMethod` enum still has
 * CARD and OTHER for historical sales, so the column and past receipts keep
 * rendering — the till just never writes them.
 */
type PayMethod = Extract<PaymentMethod, 'CASH' | 'GCASH'>;

const METHOD_LABEL: Record<PayMethod, string> = { CASH: 'Cash', GCASH: 'GCash' };

/** Matches a scanned or typed code against a loaded list, ignoring pack spacing. */
function matchExact(list: SellableProduct[], value: string): SellableProduct | undefined {
  const code = normalizeBarcode(value);
  return (
    list.find((p) => p.barcode && normalizeBarcode(p.barcode) === code) ??
    list.find((p) => normalizeBarcode(p.sku) === code)
  );
}

/** The notes customers actually hand over. */
const QUICK_CASH = [20, 50, 100, 200, 500];

/**
 * Keeps the money fields to digits and a single decimal point.
 *
 * These use `type="text"` with a decimal `inputMode` rather than
 * `type="number"`: the number spinners land on top of the right-aligned figure
 * in a field this large, and a decimal inputMode already brings up the numeric
 * keypad on both Android and iOS.
 */
function sanitizeAmount(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

function currencySymbolFor(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('en-PH', { style: 'currency', currency })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? '₱'
    );
  } catch {
    return '₱';
  }
}

export function PosTerminal({
  initialProducts,
  currency,
  taxRate,
  company,
  cashierName,
  gcash,
  canEditStoreSettings,
  canCreateProducts,
  categoryChips,
  lowStockLevel,
  openShift,
}: PosTerminalProps) {
  const router = useRouter();

  const [term, setTerm] = React.useState('');
  const [products, setProducts] = React.useState(initialProducts);
  const [searching, setSearching] = React.useState(false);

  // Grid filters. Applied on the server so a chip's count always matches what
  // the grid can actually show, not just the page already loaded.
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = React.useState(false);
  const [sort, setSort] = React.useState<SellableSort>('name');

  const [basket, setBasket] = React.useState<BasketLine[]>([]);
  // A parked order lives in this browser only — nothing reaches the database
  // until the sale is actually charged.
  const [heldOrder, setHeldOrder] = React.useState<HeldOrder | null>(null);
  const [orderDiscount, setOrderDiscount] = React.useState('0');
  const [notes, setNotes] = React.useState('');

  const [payOpen, setPayOpen] = React.useState(false);
  const [method, setMethod] = React.useState<PayMethod>('CASH');
  const [cashReceived, setCashReceived] = React.useState('');
  const [gcashAmount, setGcashAmount] = React.useState('');
  const [gcashReference, setGcashReference] = React.useState('');
  const [copiedGcash, setCopiedGcash] = React.useState(false);
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

  const runLookup = React.useCallback(
    async (value: string) => {
      setSearching(true);
      const result = await lookupProducts(value, {
        categoryId: categoryId ?? undefined,
        lowStockAtOrBelow: lowStockOnly ? lowStockLevel : undefined,
        sort,
      });
      setSearching(false);
      if (result.ok) setProducts(result.data);
    },
    [categoryId, lowStockOnly, lowStockLevel, sort],
  );

  React.useEffect(() => {
    const timer = setTimeout(() => void runLookup(term), 250);
    return () => clearTimeout(timer);
  }, [term, runLookup]);

  // F2 or "/" jumps to the search/scan field from anywhere on the page.
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (event.key === 'F2' || (event.key === '/' && !typing)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Basket --------------------------------------------------------------

  // Mirrors the basket for the scan path, which has to know the current
  // quantity *before* deciding whether one more would exceed stock.
  const basketRef = React.useRef<BasketLine[]>([]);
  React.useEffect(() => {
    basketRef.current = basket;
  }, [basket]);

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
          imageUrl: product.imageUrl,
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

  /**
   * Rings one scanned or typed code straight into the cart.
   *
   * Shared by all three ways a code can arrive: the camera scanner, a
   * USB/Bluetooth scanner typing into the search box, and the cashier typing
   * it by hand. Stock is only checked here — nothing is deducted until the
   * sale is completed.
   */
  const addScannedProduct = React.useCallback(
    (product: SellableProduct) => {
      const existing = basketRef.current.find((line) => line.productId === product.id);
      const nextQuantity = (existing?.quantity ?? 0) + 1;

      if (product.isTrackable && nextQuantity > product.available) {
        toast.error(
          product.available <= 0
            ? `${product.name} — out of stock.`
            : `Only ${formatQuantity(product.available)} of ${product.name} left.`,
        );
        return;
      }

      addToBasket(product);
      toast.success(`${product.name} × ${formatQuantity(nextQuantity)}`, { duration: 1500 });
    },
    [addToBasket],
  );

  const resolveCode = React.useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;

      const accept = (product: SellableProduct) => {
        addScannedProduct(product);
        setTerm('');
        searchRef.current?.focus();
      };

      // Already on screen — the usual case for a small catalogue.
      const onScreen = matchExact(products, value);
      if (onScreen) {
        accept(onScreen);
        return;
      }

      setSearching(true);
      // Barcode first, and tolerant of separators: a code typed into the
      // catalogue as it reads on the pack still matches what the scanner sends.
      const byBarcode = await lookupBarcode(value);
      if (byBarcode.ok && byBarcode.data) {
        setSearching(false);
        accept(byBarcode.data);
        return;
      }

      const result = await lookupProducts(value);
      setSearching(false);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const matches = result.data;
      const exact = matchExact(matches, value);
      const only = matches.length === 1 ? matches[0] : undefined;
      const hit = exact ?? only;

      if (hit) {
        accept(hit);
        return;
      }

      if (matches.length === 0) {
        toast.error('Product not found', {
          description: value,
          duration: 8000,
          ...(canCreateProducts
            ? {
                action: {
                  label: 'Add to Inventory',
                  onClick: () => router.push('/products/new'),
                },
              }
            : {}),
        });
        return;
      }

      // Several name matches — show them and let the cashier tap one.
      setProducts(matches);
    },
    [products, addScannedProduct, canCreateProducts, router],
  );

  const onSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void resolveCode(term);
  };

  const termRef = React.useRef(term);
  React.useEffect(() => {
    termRef.current = term;
  }, [term]);

  /**
   * Keeps a barcode field ready at all times for USB/Bluetooth scanners,
   * which are just keyboards that type fast and press Enter.
   *
   * The cashier should never have to click the search box first, so any
   * stray keystroke that lands on the page rather than in a field is pulled
   * into the search input. Once it has focus the remaining characters arrive
   * there natively.
   */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog is open — payment, receipt, shift or the camera scanner.
      if (document.querySelector('[role="dialog"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const alreadyTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      if (alreadyTyping) return;

      if (event.key === 'Enter') {
        if (termRef.current.trim()) {
          event.preventDefault();
          void resolveCode(termRef.current);
        }
        return;
      }

      if (event.key.length === 1) {
        event.preventDefault();
        searchRef.current?.focus();
        setTerm((current) => current + event.key);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resolveCode]);

  const focusSearch = () => {
    // After a dialog closes, Radix restores focus to its trigger on the next
    // tick — so claim it back after that.
    setTimeout(() => searchRef.current?.focus(), 0);
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

  // --- Held order ----------------------------------------------------------

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HELD_ORDER_KEY);
      if (raw) setHeldOrder(JSON.parse(raw) as HeldOrder);
    } catch {
      // A corrupt or unavailable store just means there is nothing parked.
    }
  }, []);

  const heldCount = heldOrder?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;

  const holdOrder = () => {
    if (basket.length === 0) return;
    const parked: HeldOrder = { lines: basket, discount: orderDiscount, notes, heldAt: Date.now() };
    try {
      window.localStorage.setItem(HELD_ORDER_KEY, JSON.stringify(parked));
    } catch {
      toast.error('This browser would not let the order be held.');
      return;
    }
    setHeldOrder(parked);
    clearBasket();
    toast.success('Order held. Resume it from the order panel.');
  };

  const resumeHeldOrder = () => {
    if (!heldOrder) return;
    setBasket(heldOrder.lines);
    setOrderDiscount(heldOrder.discount);
    setNotes(heldOrder.notes);
    try {
      window.localStorage.removeItem(HELD_ORDER_KEY);
    } catch {
      // Nothing to do — the cart is restored either way.
    }
    setHeldOrder(null);
    focusSearch();
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

  // --- Payment (one tender, cash or GCash) ---------------------------------

  const paid = round(Math.max(0, Number(method === 'CASH' ? cashReceived : gcashAmount) || 0));
  const change = method === 'CASH' ? round(Math.max(0, paid - totals.total)) : 0;
  const outstanding = round(Math.max(0, totals.total - paid));
  // The sale service takes no partial payments, so the tender has to cover the
  // whole total before the sale can be completed.
  const canComplete = totals.total > 0 && outstanding === 0;

  const currencySymbol = React.useMemo(() => currencySymbolFor(currency), [currency]);

  const copyGcashNumber = async () => {
    try {
      await navigator.clipboard.writeText(gcash.number);
      setCopiedGcash(true);
      setTimeout(() => setCopiedGcash(false), 2000);
    } catch {
      toast.error('Could not copy the number automatically.');
    }
  };

  // --- Checkout ------------------------------------------------------------

  const openPayment = () => {
    if (basket.length === 0) return;
    setMethod('CASH');
    // Cash starts blank so the cashier enters what the customer actually
    // handed over; GCash is almost always for the exact amount.
    setCashReceived('');
    setGcashAmount(totals.total.toFixed(2));
    setGcashReference('');
    setPayOpen(true);
  };

  const onCheckout = async () => {
    if (!canComplete) {
      toast.error('The payment does not cover the amount due.');
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
      payments: [
        {
          method,
          amount: paid,
          reference: method === 'GCASH' ? gcashReference.trim() || undefined : undefined,
        },
      ],
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
      payments: [{ method: METHOD_LABEL[method], amount: paid }],
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

        <form onSubmit={onSearchSubmit} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search product name or SKU"
              className="h-12 rounded-xl pl-10 pr-12"
              autoFocus
              autoComplete="off"
              inputMode="search"
              aria-label="Scan or search products"
            />
            {searching ? (
              <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:block">
                /
              </kbd>
            )}
          </div>
          <BarcodeScanButton
            onScan={(code) => void resolveCode(code)}
            label="Scan barcode"
            size="lg"
            className="h-12 w-full shrink-0 rounded-xl border-0 bg-sidebar text-sidebar-foreground hover:bg-sidebar/90 sm:w-auto"
          />
        </form>

        {/* Category chips and sort */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={!categoryId && !lowStockOnly}
            count={categoryChips.total}
            onClick={() => {
              setCategoryId(null);
              setLowStockOnly(false);
            }}
          >
            All
          </FilterChip>

          {categoryChips.categories.map((category) => (
            <FilterChip
              key={category.id}
              active={categoryId === category.id && !lowStockOnly}
              count={category.count}
              onClick={() => {
                setCategoryId(categoryId === category.id ? null : category.id);
                setLowStockOnly(false);
              }}
            >
              {category.name}
            </FilterChip>
          ))}

          {categoryChips.lowStock > 0 && (
            <FilterChip
              active={lowStockOnly}
              count={categoryChips.lowStock}
              tone="warning"
              onClick={() => {
                setLowStockOnly(!lowStockOnly);
                setCategoryId(null);
              }}
            >
              Low stock
            </FilterChip>
          )}

          <div className="ml-auto">
            <Select value={sort} onValueChange={(value) => setSort(value as SellableSort)}>
              <SelectTrigger
                className="h-9 w-[180px] rounded-xl border-0 bg-transparent text-sm text-muted-foreground shadow-none hover:bg-accent"
                aria-label="Sort products"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="name">Sort: Name A to Z</SelectItem>
                <SelectItem value="priceAsc">Sort: Price low first</SelectItem>
                <SelectItem value="priceDesc">Sort: Price high first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {products.length === 0 ? (
          <Card className="p-10 text-center">
            <Package className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
            <p className="text-sm font-medium">No products found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {term ? `Nothing matches “${term}”.` : 'Nothing here yet.'}
            </p>
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
            {products.map((product) => (
              <li key={product.id}>
                <ProductTile
                  product={product}
                  currency={currency}
                  inCart={basket.find((line) => line.productId === product.id)?.quantity ?? 0}
                  onAdd={() => addToBasket(product)}
                  onSetQuantity={(quantity) => setQuantity(product.id, quantity)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Current order */}
      <Card className="flex h-fit flex-col rounded-2xl xl:sticky xl:top-[4.5rem] xl:max-h-[calc(100dvh-6rem)]">
        <div className="flex items-start justify-between gap-2 p-4 pb-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">Current order</p>
            <p className="truncate text-xs text-muted-foreground">
              {cashierName}
              {totals.itemCount > 0
                ? ` · ${formatQuantity(totals.itemCount)} item${totals.itemCount === 1 ? '' : 's'}`
                : ' · Walk-in customer'}
            </p>
          </div>
          {basket.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearBasket} className="h-7 shrink-0 text-xs">
              <X /> Clear
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t scrollbar-thin">
          {basket.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <ShoppingCart className="mx-auto mb-2 h-7 w-7 text-muted-foreground/30" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Scan or tap a product to start.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {basket.map((line) => (
                <li key={line.productId} className="p-3">
                  <div className="flex items-start gap-3">
                    <ProductImage
                      src={line.imageUrl}
                      alt={line.name}
                      size="sm"
                      fit="cover"
                      className="h-10 w-10 shrink-0 rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatQuantity(line.quantity)} × {formatCurrency(line.unitPrice, currency)}
                      </p>
                    </div>
                    <span className="tabular whitespace-nowrap text-sm font-semibold">
                      {formatCurrency(line.unitPrice * line.quantity - line.discount, currency)}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-1.5">
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
                      className="h-7 w-14 text-center"
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

                    <button
                      type="button"
                      onClick={() => setQuantity(line.productId, 0)}
                      className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t p-4">
          <Row
            label={`Subtotal (${formatQuantity(totals.itemCount)} item${totals.itemCount === 1 ? '' : 's'})`}
            value={formatCurrency(totals.subtotal, currency)}
          />
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
              className="h-8 w-24 text-right"
            />
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">Total</span>
            <span className="tabular text-2xl font-bold">{formatCurrency(totals.total, currency)}</span>
          </div>

          <Button
            className="h-12 w-full rounded-xl bg-[#F5B70A] text-base font-semibold text-[#20160A] hover:bg-[#E0A609]"
            disabled={basket.length === 0}
            onClick={openPayment}
          >
            Charge {formatCurrency(totals.total, currency)}
          </Button>

          {basket.length > 0 ? (
            <Button variant="outline" className="h-11 w-full rounded-xl" onClick={holdOrder}>
              Hold order
            </Button>
          ) : (
            heldOrder && (
              <Button variant="outline" className="h-11 w-full rounded-xl" onClick={resumeHeldOrder}>
                <Undo2 /> Resume held order ({formatQuantity(heldCount)})
              </Button>
            )
          )}
        </div>
      </Card>

      {/* Payment */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Take Payment</DialogTitle>
            <DialogDescription>
              {formatQuantity(totals.itemCount)} item{totals.itemCount === 1 ? '' : 's'} in this sale.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Amount due — the number the cashier reads out loud */}
            <div className="rounded-xl border bg-muted/40 px-4 py-3 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount Due</p>
              <p className="tabular mt-0.5 text-4xl font-bold leading-tight">
                {formatCurrency(totals.total, currency)}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Payment Method</Label>
              <div className="grid grid-cols-2 gap-2">
                <MethodButton
                  active={method === 'CASH'}
                  icon={Banknote}
                  label="Cash"
                  onClick={() => setMethod('CASH')}
                />
                <MethodButton
                  active={method === 'GCASH'}
                  icon={Smartphone}
                  label="GCash"
                  onClick={() => setMethod('GCASH')}
                />
              </div>
            </div>

            {method === 'CASH' ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cash-received">Cash Received</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
                      {currencySymbol}
                    </span>
                    <Input
                      id="cash-received"
                      type="text"
                      inputMode="decimal"
                      value={cashReceived}
                      onChange={(event) => setCashReceived(sanitizeAmount(event.target.value))}
                      placeholder="0.00"
                      autoFocus
                      className="tabular h-14 pl-9 text-right text-2xl font-semibold"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tabular"
                    onClick={() => setCashReceived(totals.total.toFixed(2))}
                  >
                    Exact
                  </Button>
                  {/* Only notes that actually cover the bill — tapping one must
                      never leave the sale short. */}
                  {QUICK_CASH.filter((amount) => amount >= totals.total).map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="tabular"
                      onClick={() => setCashReceived(amount.toFixed(2))}
                    >
                      ₱{amount}
                    </Button>
                  ))}
                </div>

                {outstanding > 0 ? (
                  <div className="rounded-xl bg-destructive/10 px-4 py-3 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-destructive">
                      Amount still due
                    </p>
                    <p className="tabular mt-0.5 text-3xl font-bold text-destructive">
                      {formatCurrency(outstanding, currency)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-success/10 px-4 py-3 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-success">Change</p>
                    <p className="tabular mt-0.5 text-3xl font-bold text-success">
                      {formatCurrency(change, currency)}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {gcash.number ? (
                  <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Send payment to
                    </p>
                    <p className="tabular text-2xl font-bold leading-tight">
                      {formatPhoneNumber(gcash.number)}
                    </p>
                    {gcash.accountName && <p className="text-sm text-muted-foreground">{gcash.accountName}</p>}
                    <Button type="button" variant="outline" size="sm" onClick={copyGcashNumber}>
                      {copiedGcash ? <Check /> : <Copy />} {copiedGcash ? 'Copied' : 'Copy Number'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-center">
                    <p className="text-sm font-medium text-warning">GCash number has not been set.</p>
                    {canEditStoreSettings && (
                      <Button type="button" variant="outline" size="sm" asChild>
                        <Link href="/settings">
                          <SettingsIcon /> Set GCash Number
                        </Link>
                      </Button>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="gcash-amount">Payment Amount</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
                      {currencySymbol}
                    </span>
                    <Input
                      id="gcash-amount"
                      type="text"
                      inputMode="decimal"
                      value={gcashAmount}
                      onChange={(event) => setGcashAmount(sanitizeAmount(event.target.value))}
                      placeholder="0.00"
                      className="tabular h-14 pl-9 text-right text-2xl font-semibold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="gcash-reference">GCash Reference Number</Label>
                  <Input
                    id="gcash-reference"
                    inputMode="numeric"
                    value={gcashReference}
                    onChange={(event) => setGcashReference(event.target.value)}
                    placeholder="Enter reference number"
                    maxLength={80}
                  />
                </div>

                {outstanding > 0 && (
                  <div className="rounded-xl bg-destructive/10 px-4 py-3 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-destructive">
                      Amount still due
                    </p>
                    <p className="tabular mt-0.5 text-3xl font-bold text-destructive">
                      {formatCurrency(outstanding, currency)}
                    </p>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <div className="space-y-1.5">
              <Row label="Amount Due" value={formatCurrency(totals.total, currency)} />
              {method === 'CASH' ? (
                <>
                  <Row label="Cash Received" value={formatCurrency(paid, currency)} />
                  <Row label="Change" value={formatCurrency(change, currency)} />
                </>
              ) : (
                <>
                  <Row label="GCash Payment" value={formatCurrency(paid, currency)} />
                  {gcashReference.trim() && <Row label="Reference" value={gcashReference.trim()} />}
                </>
              )}
            </div>

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
            <Button onClick={onCheckout} loading={submitting} disabled={!canComplete}>
              Complete Sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt */}
      <Dialog
        open={receipt !== null}
        onOpenChange={(open) => {
          if (open) return;
          setReceipt(null);
          // Ready for the next customer without clicking anything.
          focusSearch();
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader className="no-print">
            <DialogTitle>Sale complete</DialogTitle>
            <DialogDescription>{receipt?.invoiceNumber}</DialogDescription>
          </DialogHeader>

          {receipt && <Receipt data={receipt} />}

          <DialogFooter className="no-print">
            <Button
              variant="outline"
              onClick={() => {
                setReceipt(null);
                focusSearch();
              }}
            >
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

function MethodButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Banknote;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Groups an 11-digit PH mobile number as 0917 123 4567; anything else is shown as entered. */
function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return raw;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

/** One parked order, kept in this browser between sales. */
interface HeldOrder {
  lines: BasketLine[];
  discount: string;
  notes: string;
  heldAt: number;
}

const HELD_ORDER_KEY = 'pos:held-order';

function FilterChip({
  active,
  count,
  tone = 'default',
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  tone?: 'default' | 'warning';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-transparent bg-sidebar text-sidebar-foreground'
          : tone === 'warning'
            ? 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15'
            : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
      <span className={cn('tabular text-xs', active ? 'text-sidebar-foreground/70' : 'text-muted-foreground')}>
        {count}
      </span>
    </button>
  );
}

/** Stable colour per product, so a picture-less tile still looks deliberate. */
const PLACEHOLDER_TONES = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-cyan-100 text-cyan-700',
];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PLACEHOLDER_TONES[hash % PLACEHOLDER_TONES.length];
}

function ProductTile({
  product,
  currency,
  inCart,
  onAdd,
  onSetQuantity,
}: {
  product: SellableProduct;
  currency: string;
  inCart: number;
  onAdd: () => void;
  onSetQuantity: (quantity: number) => void;
}) {
  const soldOut = product.isTrackable && product.available <= 0;
  const low = product.isTrackable && product.available > 0 && product.available < 10;

  return (
    // The tile is clickable for speed at the counter, but it is deliberately
    // not a button: the stepper inside is, and nesting controls would leave
    // screen readers announcing a button inside a button.
    <div
      onClick={soldOut ? undefined : onAdd}
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-[14px] border bg-card text-left shadow-2xs transition-colors',
        soldOut ? 'opacity-60' : 'cursor-pointer hover:border-primary/40 hover:bg-accent/30',
        inCart > 0 && 'border-primary ring-2 ring-primary/15',
      )}
    >
      <div className="relative flex h-[150px] w-full items-center justify-center bg-muted/70">
        {product.imageUrl ? (
          <ProductImage
            src={product.imageUrl}
            alt={product.name}
            size="fill"
            className="rounded-none border-0 bg-transparent"
          />
        ) : (
          <span
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-semibold',
              toneFor(product.name),
            )}
            aria-hidden="true"
          >
            {initialsFor(product.name)}
          </span>
        )}

        <span
          className={cn(
            'absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
            soldOut
              ? 'bg-destructive/10 text-destructive'
              : low
                ? 'bg-warning/15 text-warning'
                : 'bg-success/10 text-success',
          )}
        >
          {!product.isTrackable
            ? 'Service'
            : soldOut
              ? 'Out of stock'
              : low
                ? `${formatQuantity(product.available)} left`
                : `${formatQuantity(product.available)} in stock`}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{product.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{product.sku}</p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="tabular text-lg font-bold">{formatCurrency(product.sellingPrice, currency)}</span>

          {soldOut ? null : inCart > 0 ? (
            <span
              className="flex items-center gap-1 rounded-lg bg-primary p-0.5 text-primary-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onSetQuantity(inCart - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label={`Remove one ${product.name}`}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="tabular min-w-6 text-center text-sm font-semibold">
                {formatQuantity(inCart)}
              </span>
              <button
                type="button"
                onClick={() => onSetQuantity(inCart + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label={`Add one ${product.name}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                // The tile already handles the click; this is the keyboard and
                // screen-reader route to the same action.
                event.stopPropagation();
                onAdd();
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Add ${product.name}`}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          )}
        </div>
      </div>
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
