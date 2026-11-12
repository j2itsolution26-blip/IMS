'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Banknote,
  Check,
  Copy,
  Loader2,
  Minus,
  MoreHorizontal,
  Package,
  Pencil,
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
import { ShiftBar, ShiftGate } from '@/features/pos/shift-dialogs';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox, Separator } from '@/components/ui/misc';
import { GCASH_REFERENCE_OPTIONAL_HINT, optionalGcashReference, quickCashOptions, tenderSummary } from '@/lib/tender';
import { Receipt, type ReceiptData } from '@/features/pos/receipt';
import { PosCameraScanner, type ScanOutcome } from '@/features/pos/pos-camera-scanner';
import { QuantityInput } from '@/features/pos/quantity-input';
import { QuantityPresets } from '@/features/pos/quantity-presets';
import { formatSaleQuantity, pricePer } from '@/lib/quantity-presets';
import { useOnlineStatus } from '@/features/pwa/use-online-status';
import type { CheckoutInput } from '@/features/pos/checkout-schema';
import type { OfflineSale } from '@/lib/offline-sale';
import { openLocalDb, requestPersistentStorage, type StoredReceipt } from '@/features/offline/local-db';
import { recordSale } from '@/features/offline/outbox';
import { SyncEngine } from '@/features/offline/sync-engine';
import { announceOutboxChange, getSyncEngine, useSyncState } from '@/features/offline/sync-client';
import { localFind, localSearch } from '@/features/offline/catalog';
import { CATALOG_REFRESH_MS, loadCatalog, refreshCatalog, useOfflineCatalog } from '@/features/offline/catalog-client';
import { READINESS_MESSAGE, offlineReadiness } from '@/lib/offline-catalog';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { UNITS, type ProductUnit } from '@/lib/quantity';
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
 *
 * A completed sale is first saved on this device (src/features/offline), then
 * sent to the server under the device's id for it. A clear answer completes or
 * declines it as before. If the answer is lost (the connection drops mid-sale,
 * the server errors), the sale stays on the device as PENDING SYNC and is sent
 * again with the same id until the server has it — never twice.
 */

export interface OpenShiftInfo {
  id: string;
  openedAt: string;
  openingCash: number;
  /** The branch whose drawer this is: an uploaded sale is filed there. */
  warehouseId: string;
}

export interface PosTerminalProps {
  initialProducts: SellableProduct[];
  /** Pre-fills the search box, e.g. a lookup carried over from the dashboard. */
  initialQuery?: string;
  currency: string;
  taxRate: number;
  company: {
    name: string;
    address: string;
    phone: string;
    receiptFooter: string;
    logoUrl?: string;
  };
  cashierName: string;
  cashierId: string;
  storeId: string;
  /** When the server read the prices on this page (ISO). */
  pricedAt: string;
  /** Read-only at the till — only an Owner can change these, from Settings. */
  gcash: { number: string; accountName: string };
  canEditStoreSettings: boolean;
  canCreateProducts: boolean;
  canEditProduct: boolean;
  categoryChips: { total: number; lowStock: number; categories: PosCategoryChip[] };
  lowStockLevel: number;
  openShift: OpenShiftInfo | null;
  /** Settings › suggested starting cash; a hint on the Open Shift dialog only. */
  suggestedOpeningCash: number;
  /** GCash cash-in / cash-out services, turned on by the owner in Settings. */
  walletServices?: boolean;
  /** Offline cash sales, turned on by the owner in Settings. */
  offlineMode?: boolean;
}

interface BasketLine {
  productId: string;
  name: string;
  sku: string;
  /** Optional: orders held before this field existed don't carry it. */
  barcode?: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  discount: number;
  available: number;
  isTrackable: boolean;
  /** Optional: orders held before units existed are whole pieces. */
  unit?: ProductUnit;
  allowsDecimal?: boolean;
  /** The product's own quick quantities; absent or empty: its unit's standard ones. */
  quantityPresets?: number[];
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
  initialQuery = '',
  currency,
  taxRate,
  company,
  cashierName,
  cashierId,
  storeId,
  pricedAt,
  gcash,
  canEditStoreSettings,
  canCreateProducts,
  canEditProduct,
  categoryChips,
  lowStockLevel,
  openShift,
  suggestedOpeningCash,
  walletServices = false,
  offlineMode = false,
}: PosTerminalProps) {
  const router = useRouter();

  const [term, setTerm] = React.useState(initialQuery);
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
  const [showGcashReference, setShowGcashReference] = React.useState(false);
  const [gcashConfirmed, setGcashConfirmed] = React.useState(false);
  // One id per checkout attempt: a doubled or retried submit records the sale once.
  const [checkoutRequestId, setCheckoutRequestId] = React.useState('');
  const [copiedGcash, setCopiedGcash] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  // Without a connection a sale can only be taken on a device prepared for
  // offline selling (src/features/offline): cash only, saved on the device
  // and sent when the connection returns.
  const online = useOnlineStatus();
  const catalog = useOfflineCatalog();
  const readiness = offlineReadiness(catalog.snapshot, {
    storeId,
    userId: cashierId,
    branchId: openShift?.warehouseId ?? null,
    offlineMode,
    now: Date.now(),
  });
  const offlineBlocked = !online && !readiness.ready;

  // Keeps this device's catalogue copy current while online.
  React.useEffect(() => {
    if (!storeId) return;
    void loadCatalog(storeId, cashierId, offlineMode).then(() => {
      if (offlineMode && navigator.onLine) void refreshCatalog(storeId, cashierId);
    });
    if (!offlineMode) return;
    const refresh = () => {
      if (navigator.onLine) void refreshCatalog(storeId, cashierId);
    };
    const timer = window.setInterval(refresh, CATALOG_REFRESH_MS);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
    };
  }, [storeId, cashierId, offlineMode]);

  const [receipt, setReceipt] = React.useState<ReceiptData | null>(null);
  // The oldest moment the prices in the basket may date from: the page's own
  // read, or a held order's time if one was resumed. Sent with an upload so
  // the server can tell an honest old price from a wrong one.
  const pricedSinceRef = React.useRef(pricedAt);


  // --- Product lookup ------------------------------------------------------

  const runLookup = React.useCallback(
    async (value: string) => {
      const filters = {
        categoryId: categoryId ?? undefined,
        lowStockAtOrBelow: lowStockOnly ? lowStockLevel : undefined,
        sort,
      };
      setSearching(true);
      try {
        if (navigator.onLine) {
          try {
            const result = await lookupProducts(value, filters);
            if (result.ok) setProducts(result.data);
            return;
          } catch {
            // The server cannot be reached: search the device's copy below.
          }
        }
        // Stock here is an estimate: the copy's figure less this device's sales since.
        const local = await openLocalDb()
          .then((db) => localSearch(db, { storeId, userId: cashierId }, value, filters))
          .catch(() => null);
        if (local) setProducts(local);
      } finally {
        setSearching(false);
      }
    },
    [categoryId, lowStockOnly, lowStockLevel, sort, storeId, cashierId],
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
          barcode: product.barcode,
          imageUrl: product.imageUrl,
          unitPrice: product.sellingPrice,
          quantity,
          discount: 0,
          available: product.available,
          isTrackable: product.isTrackable,
          unit: product.unit,
          allowsDecimal: product.allowsDecimal,
          quantityPresets: product.quantityPresets,
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
   * sale is completed. `quiet` leaves the reporting to the caller (the camera
   * scanner shows its own result line rather than stacking toasts).
   */
  const addScannedProduct = React.useCallback(
    (product: SellableProduct, quiet = false): ScanOutcome => {
      const existing = basketRef.current.find((line) => line.productId === product.id);
      const nextQuantity = (existing?.quantity ?? 0) + 1;

      if (product.isTrackable && nextQuantity > product.available) {
        const message =
          product.available <= 0
            ? `${product.name} — out of stock.`
            : `Only ${formatQuantity(product.available)} of ${product.name} left.`;
        if (!quiet) toast.error(message);
        return { kind: 'stock', productId: product.id, name: product.name, message };
      }

      addToBasket(product);
      if (!quiet) toast.success(`${product.name} × ${formatQuantity(nextQuantity)}`, { duration: 1500 });
      return { kind: 'added', productId: product.id, name: product.name, quantity: formatQuantity(nextQuantity) };
    },
    [addToBasket],
  );

  /**
   * Resolves a code to a product and rings it up.
   *
   * From the camera, only an exact barcode or SKU match is accepted — a camera
   * read is never a search term, so a partial name match must not ring up a
   * guess. Typed input keeps the friendlier fallbacks.
   */
  const resolveCode = React.useCallback(
    async (raw: string, { fromCamera = false }: { fromCamera?: boolean } = {}): Promise<ScanOutcome> => {
      const value = raw.trim();
      if (!value) return { kind: 'not-found' };

      const accept = (product: SellableProduct) => {
        const outcome = addScannedProduct(product, fromCamera);
        // The camera dialog holds focus; only the typed path returns to the box.
        if (!fromCamera) {
          setTerm('');
          searchRef.current?.focus();
        }
        return outcome;
      };

      const notFound = (): ScanOutcome => {
        if (!fromCamera) {
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
        }
        return { kind: 'not-found' };
      };

      // Already on screen — the usual case for a small catalogue.
      const onScreen = matchExact(products, value);
      if (onScreen) return accept(onScreen);

      // The device's copy, offline or when the server cannot be reached.
      // Null when this device holds no copy.
      const fromDevice = async (): Promise<ScanOutcome | null> => {
        const db = await openLocalDb().catch(() => null);
        if (!db) return null;
        const scope = { storeId, userId: cashierId };
        const found = await localFind(db, scope, value).catch(() => undefined);
        if (found === undefined) return null;
        if (found) return accept(found);
        if (fromCamera) return { kind: 'not-found' };
        const matches = (await localSearch(db, scope, value).catch(() => null)) ?? [];
        if (matches.length === 1) return accept(matches[0]);
        if (matches.length === 0) return notFound();
        setProducts(matches);
        return { kind: 'not-found' };
      };
      const unreachable = (): ScanOutcome => {
        const message = 'The server cannot be reached and this device has no product list. Connect to look this up.';
        if (!fromCamera) toast.error(message);
        return { kind: 'error', message };
      };

      setSearching(true);
      try {
        if (!navigator.onLine) return (await fromDevice()) ?? unreachable();

        // Barcode first, and tolerant of separators: a code typed into the
        // catalogue as it reads on the pack still matches what the scanner sends.
        let byBarcode: Awaited<ReturnType<typeof lookupBarcode>>;
        try {
          byBarcode = await lookupBarcode(value);
        } catch {
          return (await fromDevice()) ?? unreachable();
        }
        if (byBarcode.ok) {
          const found = byBarcode.data;
          if (found.status === 'sellable') return accept(found.product);
          if (found.status === 'unavailable') {
            const message = `${found.name} is ${
              found.productStatus === 'ARCHIVED' ? 'archived' : 'inactive'
            } and can't be sold.`;
            if (!fromCamera) toast.error(message);
            return { kind: 'unavailable', name: found.name, message };
          }
        }

        let result: Awaited<ReturnType<typeof lookupProducts>>;
        try {
          result = await lookupProducts(value);
        } catch {
          return (await fromDevice()) ?? unreachable();
        }
        if (!result.ok) {
          if (!fromCamera) toast.error(result.error);
          return { kind: 'error', message: result.error };
        }

        const matches = result.data;
        const exact = matchExact(matches, value);
        if (exact) return accept(exact);
        if (fromCamera) return { kind: 'not-found' };

        if (matches.length === 1) return accept(matches[0]);
        if (matches.length === 0) return notFound();

        // Several name matches — show them and let the cashier tap one.
        setProducts(matches);
        return { kind: 'not-found' };
      } finally {
        setSearching(false);
      }
    },
    [products, addScannedProduct, canCreateProducts, router, storeId, cashierId],
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

  // After the camera scanner closes, the next step is paying: bring the
  // Charge button into view and give it focus, wherever the page or the cart
  // panel is scrolled. It only moves the cashier there; nothing is charged.
  const chargeRef = React.useRef<HTMLButtonElement>(null);
  const goToCharge = React.useCallback(() => {
    const button = chargeRef.current;
    if (!button) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    button.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    // Focus without a second, instant scroll fighting the smooth one.
    button.focus({ preventScroll: true });
  }, []);

  const setQuantity = (productId: string, requested: number) => {
    setBasket((current) =>
      current.flatMap((line) => {
        if (line.productId !== productId) return [line];
        // Whole units unless the product is sold in decimals (to 3 places).
        const quantity = !Number.isFinite(requested)
          ? 0
          : line.allowsDecimal
            ? Math.round(requested * 1000) / 1000
            : Math.floor(requested);
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
    // An order parked by an older version could carry a fractional amount;
    // the till only sells whole pieces now.
    setBasket(
      heldOrder.lines.map((line) => ({
        ...line,
        quantity: line.allowsDecimal ? Math.max(0.001, Math.round(line.quantity * 1000) / 1000) : Math.max(1, Math.round(line.quantity)),
      })),
    );
    setOrderDiscount(heldOrder.discount);
    setNotes(heldOrder.notes);
    const heldAt = new Date(heldOrder.heldAt).toISOString();
    if (heldAt < pricedSinceRef.current) pricedSinceRef.current = heldAt;
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
      // Whole units count each piece; a weighed or measured line (0.5 kg,
      // 2.5 m) is one item, so kilos and meters are never added to pieces.
      itemCount: basket.reduce((acc, line) => acc + (line.allowsDecimal ? 1 : line.quantity), 0),
    };
  }, [basket, orderDiscount, taxRate]);

  // --- Payment (one tender, cash or GCash) ---------------------------------

  // Worked in whole centavos (src/lib/tender.ts), so ₱1,000 on ₱350 is exactly ₱650.
  const tender = tenderSummary({ total: totals.total, method, received: method === 'CASH' ? cashReceived : gcashAmount });
  const paid = tender.received;
  const change = tender.change;
  const outstanding = tender.outstanding;
  // Optional: blank is fine; a typed one must look like a reference.
  const gcashReferenceValid = optionalGcashReference(gcashReference).problem === null;
  // The sale service takes no partial payments, so the tender has to cover the
  // whole total; GCash must be exact and confirmed as received. The reference
  // number is optional and never holds up the sale when left blank.
  const canComplete =
    tender.canComplete && (method === 'CASH' || (gcashReferenceValid && gcashConfirmed));

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
    setShowGcashReference(false);
    setGcashConfirmed(false);
    setCheckoutRequestId(crypto.randomUUID());
    setPayOpen(true);
  };

  const onCheckout = async () => {
    if (submitting) return;
    if (!canComplete) {
      toast.error(
        tender.overpaidNonCash
          ? 'GCash must be for the exact amount due.'
          : method === 'GCASH' && tender.canComplete
            ? gcashReferenceValid
              ? 'Confirm the GCash payment arrived in the store account.'
              : 'Fix the GCash reference or clear it; it is optional.'
            : 'The payment does not cover the amount due.',
      );
      return;
    }
    // Decided once, here: an offline sale is saved on the device and sent later.
    const offlineSale = !navigator.onLine;
    if (offlineSale && !readiness.ready) {
      toast.error(`You are offline. ${READINESS_MESSAGE[readiness.reason]} Nothing has been charged.`);
      return;
    }
    if (offlineSale && method !== 'CASH') {
      toast.error('GCash needs a connection to check the store account. Take cash, or wait for the connection.');
      return;
    }

    setSubmitting(true);

    const id = checkoutRequestId || crypto.randomUUID();
    const now = new Date();
    const payment = {
      method,
      amount: paid,
      reference: method === 'GCASH' ? gcashReference.trim() || undefined : undefined,
      confirmedReceived: method === 'GCASH' ? gcashConfirmed : undefined,
    };
    const request: CheckoutInput = {
      items: basket.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discount: line.discount,
      })),
      discount: Number(orderDiscount) || 0,
      payments: [payment],
      notes: notes.trim() || undefined,
      clientRequestId: id,
    };
    const receiptLines = basket.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit ?? 'PIECE',
      unitPrice: line.unitPrice,
      discount: line.discount,
      total: round(line.unitPrice * line.quantity - line.discount),
    }));
    const receiptPayments = [
      {
        method: METHOD_LABEL[method],
        amount: paid,
        reference: method === 'GCASH' ? optionalGcashReference(gcashReference).reference : null,
      },
    ];
    // The receipt the customer gets if the server's answer never arrives.
    const localReceipt: StoredReceipt = {
      invoiceNumber: '',
      issuedAt: now.toISOString(),
      cashierName,
      lines: receiptLines,
      subtotal: totals.subtotal,
      tax: totals.tax,
      discount: totals.discount,
      total: totals.total,
      paid,
      change,
      payments: receiptPayments,
      company,
      currency,
    };
    // Cash only: the same sale as charged, for upload if the answer is lost.
    const asCharged: OfflineSale | null =
      method === 'CASH'
        ? {
            id,
            localReceiptNumber: 'pending',
            occurredAt: now.toISOString(),
            catalogFetchedAt: pricedSinceRef.current,
            userId: cashierId,
            shiftId: openShift!.id,
            warehouseId: openShift!.warehouseId,
            taxRate,
            items: basket.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
            })),
            discount: totals.discount,
            cashTendered: paid,
            total: totals.total,
            notes: notes.trim() || undefined,
          }
        : null;

    const showServerReceipt = (sale: { invoiceNumber: string; total: number; paidAmount: number; changeAmount: number }) =>
      setReceipt({
        // The receipt is built from the server's figures, not the local preview.
        invoiceNumber: sale.invoiceNumber,
        issuedAt: now,
        cashierName,
        lines: receiptLines,
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        total: sale.total,
        paid: sale.paidAmount,
        change: sale.changeAmount,
        payments: receiptPayments,
        company,
        currency,
      });

    let saved: Awaited<ReturnType<typeof recordSale>> | null = null;
    try {
      saved = await recordSale(
        await openLocalDb(),
        {
          id,
          storeId,
          userId: cashierId,
          createdAt: now.toISOString(),
          method,
          route: offlineSale ? 'sync' : 'checkout',
          checkout: request,
          offline: asCharged,
          receipt: localReceipt,
          status: 'pending',
        },
        // Online, the counter sends it while the customer waits; background passes wait.
        { holdUntil: offlineSale ? undefined : SyncEngine.counterHold(Date.now()) },
      );
      announceOutboxChange();
    } catch (error) {
      console.warn('[pos] could not save the sale on this device', error);
    }

    if (!saved && offlineSale) {
      setSubmitting(false);
      toast.error('This device could not save the sale, so it was not completed. Nothing has been charged.', { duration: 10000 });
      return;
    }

    if (saved && offlineSale) {
      setSubmitting(false);
      setReceipt({ ...saved.receipt, invoiceNumber: saved.localReceiptNumber, issuedAt: new Date(saved.receipt.issuedAt), pendingSync: true });
      void getSyncEngine().run('sale');
      void requestPersistentStorage();
    } else if (!saved) {
      // No local safety net (private window, blocked or full storage): the
      // checkout goes straight to the server as it always did.
      toast.warning('This device could not keep a copy of the sale. It is being sent straight to the server.', { id: 'no-local-store' });
      const result = await checkout(request);
      setSubmitting(false);
      if (!result.ok) {
        toast.error(result.error, { duration: 8000 });
        return;
      }
      showServerReceipt(result.data);
    } else {
      const outcome = await getSyncEngine().submitAtCounter(saved.id);
      setSubmitting(false);

      if (outcome.kind === 'declined') {
        // Nothing was charged. A changed basket gets a new id next time.
        setCheckoutRequestId(crypto.randomUUID());
        toast.error(outcome.error, { duration: 8000 });
        return;
      }
      if (outcome.kind === 'synced' && outcome.entry.result) {
        showServerReceipt(outcome.entry.result);
      } else {
        const entry = outcome.entry;
        setReceipt({ ...entry.receipt, invoiceNumber: entry.localReceiptNumber, issuedAt: new Date(entry.receipt.issuedAt), pendingSync: true });
        toast.warning('The server did not answer. The sale is saved on this device and will be sent automatically.', { duration: 10000 });
      }
      void requestPersistentStorage();
    }

    setPayOpen(false);
    clearBasket();
    void runLookup(term);
    // Offline, a refresh would fail and could navigate away from the till.
    if (navigator.onLine) router.refresh();
  };

  // Going offline: show the device's stock estimate; back online: the server's,
  // read again each time saved sales have reached the server.
  const lastSyncAt = useSyncState().lastSyncAt;
  React.useEffect(() => {
    void runLookup(termRef.current);
    // Only on a change of connection or a completed sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, lastSyncAt]);

  // --- No open shift: block the till entirely -------------------------------

  if (!openShift) {
    return <ShiftGate suggestedAmount={suggestedOpeningCash} currency={currency} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* Product picker */}
      <div className="space-y-3">
        <ShiftBar
          openedAt={openShift.openedAt}
          openingCash={openShift.openingCash}
          currency={currency}
          hasUnfinishedOrder={basket.length > 0 || heldOrder !== null}
          walletServices={walletServices}
        />

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
          <PosCameraScanner
            onScan={(code) => resolveCode(code, { fromCamera: true })}
            lines={basket.map((line) => ({
              productId: line.productId,
              name: line.name,
              code: line.barcode || line.sku,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              discount: line.discount,
              allowsDecimal: line.allowsDecimal,
              unit: line.unit,
              quantityPresets: line.quantityPresets,
            }))}
            onDone={goToCharge}
            total={totals.total}
            itemCount={totals.itemCount}
            currency={currency}
            onSetQuantity={setQuantity}
            onRemove={(productId) => setQuantity(productId, 0)}
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
          <ul className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6">
            {products.map((product) => (
              <li key={product.id}>
                <ProductTile
                  product={product}
                  currency={currency}
                  inCart={basket.find((line) => line.productId === product.id)?.quantity ?? 0}
                  canEditProduct={canEditProduct}
                  onAdd={() => addToBasket(product)}
                  onSetQuantity={(quantity) => setQuantity(product.id, quantity)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Current order */}
      <Card className="flex h-fit flex-col xl:sticky xl:top-[4.5rem] xl:max-h-[calc(100dvh-6rem)]">
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
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {line.barcode || line.sku}
                      </p>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatSaleQuantity(line.quantity, line.unit)} × {formatCurrency(line.unitPrice, currency)} {pricePer(line.unit)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="tabular block whitespace-nowrap text-base font-semibold">
                        {formatCurrency(line.unitPrice * line.quantity - line.discount, currency)}
                      </span>
                      {line.discount > 0 && (
                        <span className="tabular block text-xs text-muted-foreground">
                          −{formatCurrency(line.discount, currency)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <QuantityInput
                      value={line.quantity}
                      onChange={(quantity) => setQuantity(line.productId, quantity)}
                      allowsDecimal={line.allowsDecimal}
                      unitLabel={UNITS[line.unit ?? 'PIECE'].plural}
                      label={`Quantity for ${line.name}`}
                    />

                    <Input
                      type="number"
                      value={line.discount || ''}
                      min={0}
                      step="0.01"
                      placeholder="Disc."
                      onChange={(event) => setLineDiscount(line.productId, Number(event.target.value))}
                      className="h-10 w-20 text-right"
                      aria-label={`Discount for ${line.name}`}
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setQuantity(line.productId, 0)}
                      className="ml-auto h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive-text"
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <QuantityPresets
                    className="mt-2"
                    product={{ unit: line.unit ?? 'PIECE', allowsDecimal: Boolean(line.allowsDecimal), quantityPresets: line.quantityPresets }}
                    value={line.quantity}
                    onSelect={(quantity) => setQuantity(line.productId, quantity)}
                    label={`Quick quantities for ${line.name}`}
                  />
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
            ref={chargeRef}
            // Clear of the sticky top bar and the phone's bottom edge when
            // scrolled to after the scanner closes.
            className="h-12 w-full scroll-mb-24 scroll-mt-24 rounded-xl bg-[#F5B70A] text-base font-semibold text-[#20160A] hover:bg-[#E0A609]"
            disabled={basket.length === 0 || offlineBlocked}
            onClick={openPayment}
          >
            Charge {formatCurrency(totals.total, currency)}
          </Button>
          {!online && basket.length > 0 && (
            <p className="text-center text-xs text-warning-text">Offline. Reconnect to charge this sale.</p>
          )}

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

            {!online && (
              <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-text">
                {readiness.ready
                  ? 'Offline: cash only. The sale is saved on this device and sent when the connection returns.'
                  : `Offline: ${READINESS_MESSAGE[readiness.reason]}`}
              </p>
            )}

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
                  disabled={!online}
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
                  {quickCashOptions(totals.total).map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="tabular"
                      onClick={() => setCashReceived(amount.toFixed(2))}
                    >
                      ₱{amount.toLocaleString('en-PH')}
                    </Button>
                  ))}
                </div>

                {outstanding > 0 ? (
                  <div className="rounded-xl bg-destructive/10 px-4 py-3 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-destructive-text">
                      Amount still due
                    </p>
                    <p className="tabular mt-0.5 text-3xl font-bold text-destructive-text">
                      {formatCurrency(outstanding, currency)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-success/10 px-4 py-3 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-success-text">Change</p>
                    <p className="tabular mt-0.5 text-3xl font-bold text-success-text">
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
                    <p className="text-sm font-medium text-warning-text">GCash number has not been set.</p>
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

                {/* Optional, and out of the way: a cashier in a rush never has
                    to type the 13-digit number. */}
                {showGcashReference ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="gcash-reference">GCash reference (optional)</Label>
                    <Input
                      id="gcash-reference"
                      inputMode="numeric"
                      autoFocus
                      value={gcashReference}
                      onChange={(event) => setGcashReference(event.target.value)}
                      placeholder="From the GCash receipt"
                      maxLength={80}
                      aria-invalid={!gcashReferenceValid}
                      aria-describedby="gcash-reference-hint"
                    />
                    <p id="gcash-reference-hint" className={cn('text-xs', gcashReferenceValid ? 'text-muted-foreground' : 'text-destructive-text')}>
                      {GCASH_REFERENCE_OPTIONAL_HINT}
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setShowGcashReference(true)}
                  >
                    + Add GCash reference (optional)
                  </button>
                )}

                {/* A reference number or a customer's screenshot is not proof
                    of payment; the cashier checks the store's own account. */}
                <label
                  htmlFor="gcash-confirmed"
                  className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm"
                >
                  <Checkbox
                    id="gcash-confirmed"
                    checked={gcashConfirmed}
                    onCheckedChange={(checked) => setGcashConfirmed(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">I saw this payment arrive in the store GCash account.</span>
                    <span className="block text-xs text-muted-foreground">
                      Check the GCash app or SMS on the store phone. Do not rely on the customer&apos;s screenshot.
                    </span>
                  </span>
                </label>

                {tender.overpaidNonCash && (
                  <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-center text-sm font-medium text-destructive-text">
                    GCash must be for the exact amount due, {formatCurrency(totals.total, currency)}. There is no change on GCash.
                  </p>
                )}

                {outstanding > 0 && (
                  <div className="rounded-xl bg-destructive/10 px-4 py-3 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-destructive-text">
                      Amount still due
                    </p>
                    <p className="tabular mt-0.5 text-3xl font-bold text-destructive-text">
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
            <Button onClick={onCheckout} loading={submitting} disabled={!canComplete || offlineBlocked || (!online && method !== 'CASH')}>
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
            <DialogTitle>{receipt?.pendingSync ? 'Sale saved — pending sync' : 'Sale complete'}</DialogTitle>
            <DialogDescription>
              {receipt?.pendingSync
                ? `${receipt.invoiceNumber} is saved on this device and will be sent automatically. The official invoice number is assigned when it reaches the server.`
                : receipt?.invoiceNumber}
            </DialogDescription>
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

    </div>
  );
}

function MethodButton({
  active,
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  active: boolean;
  icon: typeof Banknote;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
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
            ? 'border-warning/30 bg-warning/10 text-warning-text hover:bg-warning/15'
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
  canEditProduct,
  onAdd,
  onSetQuantity,
}: {
  product: SellableProduct;
  currency: string;
  inCart: number;
  canEditProduct: boolean;
  onAdd: () => void;
  onSetQuantity: (quantity: number) => void;
}) {
  const soldOut = product.isTrackable && product.available <= 0;
  const low = product.isTrackable && product.available > 0 && product.available < 10;

  const stock = !product.isTrackable
    ? { label: 'Service', text: 'text-muted-foreground', dot: 'bg-muted-foreground' }
    : soldOut
      ? { label: 'Out of stock', text: 'text-destructive-text', dot: 'bg-destructive' }
      : low
        ? { label: `${formatQuantity(product.available)} left`, text: 'text-warning-text', dot: 'bg-warning' }
        : {
            label: `${formatQuantity(product.available)} in stock`,
            text: 'text-success-text',
            dot: 'bg-success',
          };

  return (
    // The tile is clickable for speed at the counter, but it is deliberately
    // not a button: the stepper and the menu sit inside it, and nesting
    // controls would leave screen readers announcing a button in a button.
    <div
      onClick={soldOut ? undefined : onAdd}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-card border bg-card text-left shadow-card transition-[border-color,box-shadow,background-color] duration-150',
        soldOut ? 'opacity-70' : 'cursor-pointer hover:border-primary/40 hover:shadow-sm',
        inCart > 0 && 'border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]',
      )}
    >
      {/* A fixed-height photo well rather than an aspect ratio: on a wide
          tile 4:3 grew the image to most of the card, pushing the price and
          Add button below the fold. Photos are contain-fitted, never cropped. */}
      <div className="relative h-[104px] w-full shrink-0 bg-muted/60 sm:h-[120px] xl:h-[128px]">
        <div className="absolute inset-0 flex items-center justify-center px-2 pb-1 pt-6">
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
                'flex h-14 w-14 items-center justify-center rounded-xl text-lg font-semibold',
                toneFor(product.name),
              )}
              aria-hidden="true"
            >
              {initialsFor(product.name)}
            </span>
          )}
        </div>

        {/* Status is spelled out, not just coloured, so it survives a
            colour-blind reader and a sun-washed phone screen. */}
        <span
          className={cn(
            'absolute left-2 top-2 inline-flex max-w-[calc(100%-3.25rem)] items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-semibold shadow-2xs backdrop-blur-sm',
            stock.text,
          )}
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', stock.dot)} aria-hidden="true" />
          <span className="truncate">{stock.label}</span>
        </span>

        <div className="absolute right-1 top-1" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full bg-card/80 text-muted-foreground backdrop-blur hover:bg-card hover:text-foreground"
                aria-label={`Options for ${product.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/products/${product.id}`}>
                  <Package /> View product
                </Link>
              </DropdownMenuItem>
              {canEditProduct && (
                <DropdownMenuItem asChild>
                  <Link href={`/products/${product.id}/edit`}>
                    <Pencil /> Edit product
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        {/* Two lines are always reserved, so a short name does not make its
            tile shorter than its neighbours. */}
        <p className="line-clamp-2 min-h-[2.5em] text-base font-semibold leading-tight sm:text-[17px]">
          {product.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={product.sku}>
          {product.sku}
        </p>

        {/* Pinned to the bottom so price and Add line up across a row; wraps
            rather than overflowing on the narrowest tiles. */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pt-2">
          <span className="tabular text-xl font-bold leading-none">
            {formatCurrency(product.sellingPrice, currency)}
          </span>

          {soldOut ? null : inCart > 0 ? (
            <span
              className="flex items-center rounded-xl bg-primary p-1 text-primary-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onSetQuantity(inCart - 1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                aria-label={`Remove one ${product.name}`}
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="tabular min-w-8 px-1 text-center text-[15px] font-semibold">
                {formatQuantity(inCart)}
              </span>
              <button
                type="button"
                onClick={() => onSetQuantity(inCart + 1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                aria-label={`Add one ${product.name}`}
              >
                <Plus className="h-4 w-4" />
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
              className="inline-flex h-10 items-center gap-1 rounded-xl bg-primary/10 px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/15 active:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Add ${product.name}`}
            >
              <Plus className="h-4 w-4" /> Add
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
