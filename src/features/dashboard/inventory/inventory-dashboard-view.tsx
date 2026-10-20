import Link from 'next/link';
import type { InventoryTransactionType } from '@prisma/client';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  ClipboardList,
  History,
  PackageCheck,
  PackagePlus,
  PackageX,
  PhilippinePeso,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { InventoryDashboardData } from '@/server/analytics/inventory-dashboard';
import type { Paginated, StockLevelRow } from '@/server/analytics/inventory-analytics';
import { formatCurrency, formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { formatPieces } from '@/lib/quantity';
import { cn } from '@/lib/utils';
import { Panel, PanelEmpty } from '@/components/panel';
import { ProductImage } from '@/components/product-image';
import { PaginationBar } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KpiCard } from '@/features/dashboard/kpi-card';
import { ProductRowActions } from '@/features/inventory/product-row-actions';
import { CategoryBarChart, MovementTrendChart, StockStatusDonut } from '@/features/dashboard/inventory/inventory-charts';

/**
 * The Inventory Operations Dashboard.
 *
 * Shown to Inventory Staff (and to the owner under Dashboard → Inventory).
 * Everything here is stock: levels, restocking needs, categories and the
 * stock ledger. It is built only from `getInventoryDashboard` and the stock
 * register, neither of which reads takings, payments or profit.
 */

export type AttentionFilter = 'ALL' | 'LOW_ANY' | 'OUT_OF_STOCK' | 'IN_STOCK';

export const ATTENTION_FILTERS: { value: AttentionFilter; label: string }[] = [
  { value: 'ALL', label: 'All products' },
  { value: 'LOW_ANY', label: 'Low stock' },
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'IN_STOCK', label: 'In stock' },
];

export interface AttentionQuery {
  status: AttentionFilter;
  q: string;
}

const MOVEMENT_LABEL: Record<InventoryTransactionType, string> = {
  STOCK_IN: 'Received',
  SALE: 'Sold',
  SALE_RETURN: 'Returned',
  ADJUSTMENT_IN: 'Adjusted up',
  ADJUSTMENT_OUT: 'Adjusted down',
  OPENING_BALANCE: 'Opening balance',
};

export function InventoryDashboardView({
  data,
  attention,
  attentionQuery,
  basePath,
  baseParams = {},
  currency,
  canAdjustStock,
  canEditProduct,
  header,
}: {
  data: InventoryDashboardData;
  attention: Paginated<StockLevelRow>;
  attentionQuery: AttentionQuery;
  /** Where the filter and search links point, normally /dashboard. */
  basePath: string;
  /** Params every link must keep, e.g. { view: 'inventory' } on the owner's dashboard. */
  baseParams?: Record<string, string>;
  currency: string;
  canAdjustStock: boolean;
  canEditProduct: boolean;
  header?: React.ReactNode;
}) {
  const { kpis } = data;

  const hrefFor = (patch: Partial<{ status: string; q: string; page: string }>) => {
    const params = new URLSearchParams(baseParams);
    const next = { status: attentionQuery.status, q: attentionQuery.q, ...patch };
    if (next.status && next.status !== 'ALL') params.set('status', next.status);
    if (next.q) params.set('q', next.q);
    if (patch.page) params.set('page', patch.page);
    const search = params.toString();
    return `${basePath}${search ? `?${search}` : ''}#attention`;
  };

  return (
    <>
      {header}

      {/* KPI cards — six figures, each one a door to the list behind it. */}
      <section
        aria-label="Inventory summary"
        className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
      >
        <KpiCard
          label="Total products"
          value={formatNumber(kpis.totalProducts, 0)}
          icon={Boxes}
          hint={`${formatNumber(kpis.activeCategories, 0)} categor${kpis.activeCategories === 1 ? 'y' : 'ies'}${
            kpis.untrackedProducts > 0 ? ` · ${formatNumber(kpis.untrackedProducts, 0)} not tracked` : ''
          }`}
          href="/inventory"
        />
        <KpiCard
          label="Low stock"
          value={formatNumber(kpis.lowStock, 0)}
          icon={TriangleAlert}
          tone={kpis.lowStock > 0 ? 'warning' : 'default'}
          hint="At or below their low-stock level"
          href={hrefFor({ status: 'LOW_ANY', q: '' })}
        />
        <KpiCard
          label="Out of stock"
          value={formatNumber(kpis.outOfStock, 0)}
          icon={PackageX}
          tone={kpis.outOfStock > 0 ? 'destructive' : 'default'}
          hint={kpis.outOfStock > 0 ? 'Nothing left to sell' : 'Every product has stock'}
          href={hrefFor({ status: 'OUT_OF_STOCK', q: '' })}
        />
        <KpiCard
          label="In stock"
          value={formatNumber(kpis.inStock, 0)}
          icon={PackageCheck}
          tone="success"
          hint="Above their low-stock level"
          href={hrefFor({ status: 'IN_STOCK', q: '' })}
        />
        <KpiCard
          label="Restock required"
          value={formatNumber(kpis.restockRequired, 0)}
          icon={PackagePlus}
          tone={kpis.restockRequired > 0 ? 'warning' : 'default'}
          hint={
            kpis.restockRequired === 0
              ? 'Nothing to reorder'
              : kpis.restockWithSuggestion > 0
                ? `Suggested ${formatPieces(kpis.suggestedPieces)} across ${formatNumber(kpis.restockWithSuggestion, 0)}`
                : 'No reorder quantity set — see each product'
          }
          href="#reorder"
        />
        <KpiCard
          label="Stock movements today"
          value={formatNumber(kpis.movementsToday, 0)}
          icon={History}
          hint={
            kpis.piecesReceivedToday > 0
              ? `${formatPieces(kpis.piecesReceivedToday)} received`
              : 'Receipts and adjustments'
          }
          href="/inventory/movements?period=today"
        />
      </section>

      {kpis.stockValue != null && (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <PhilippinePeso className="h-4 w-4" aria-hidden="true" />
          Stock value at cost:{' '}
          <span className="tabular font-semibold text-foreground">{formatCurrency(kpis.stockValue, currency)}</span>
        </p>
      )}

      {/* Charts */}
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Stock status" description="Every tracked product, counted once.">
          <StockStatusDonut
            data={[
              { key: 'IN', label: 'In stock', value: kpis.inStock, href: hrefFor({ status: 'IN_STOCK', q: '' }) },
              { key: 'LOW', label: 'Low stock', value: kpis.lowStock, href: hrefFor({ status: 'LOW_ANY', q: '' }) },
              { key: 'OUT', label: 'Out of stock', value: kpis.outOfStock, href: hrefFor({ status: 'OUT_OF_STOCK', q: '' }) },
            ]}
          />
        </Panel>
        <Panel
          title="Products by category"
          description="Active products in each category. Select a bar to open it."
          action={<MoreLink href="/inventory/categories">Categories</MoreLink>}
        >
          <CategoryBarChart data={data.categories} />
        </Panel>
      </div>

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Stock movements — last 7 days"
          description="Pieces received, and the net of adjustments, per day."
          action={<MoreLink href="/inventory/movements?period=last7">History</MoreLink>}
        >
          <MovementTrendChart data={data.movementTrend} hasHistory={data.hasMovementHistory} />
        </Panel>
        <div id="reorder" className="scroll-mt-20">
          <ReorderPanel rows={data.reorder} canAdjustStock={canAdjustStock} canEditProduct={canEditProduct} />
        </div>
      </div>

      {/* Attention list */}
      <section id="attention" aria-labelledby="attention-heading" className="mb-4 scroll-mt-20">
        <div className="overflow-hidden rounded-xl border bg-card shadow-2xs">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <h2 id="attention-heading" className="text-base font-semibold leading-tight">
                Inventory attention list
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Out of stock first, then low stock. Search by name, SKU or barcode.
              </p>
            </div>
            <form action={basePath} method="get" className="flex w-full gap-2 sm:w-auto" role="search">
              {Object.entries(baseParams).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              {attentionQuery.status !== 'ALL' && <input type="hidden" name="status" value={attentionQuery.status} />}
              <Input
                name="q"
                defaultValue={attentionQuery.q}
                placeholder="Name, SKU or barcode"
                aria-label="Search products"
                className="h-10 w-full sm:w-64"
              />
              <Button type="submit" variant="outline" className="h-10 shrink-0" aria-label="Search">
                <Search className="h-4 w-4" />
              </Button>
            </form>
          </div>

          <nav aria-label="Filter by stock status" className="flex gap-1 overflow-x-auto border-b px-3 py-2 scrollbar-thin">
            {ATTENTION_FILTERS.map((filter) => {
              const active = attentionQuery.status === filter.value;
              const count =
                filter.value === 'ALL'
                  ? kpis.totalProducts
                  : filter.value === 'LOW_ANY'
                    ? kpis.lowStock
                    : filter.value === 'OUT_OF_STOCK'
                      ? kpis.outOfStock
                      : kpis.inStock;
              return (
                <Link
                  key={filter.value}
                  href={hrefFor({ status: filter.value, page: undefined })}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {filter.label}
                  <span className={cn('tabular rounded-full px-1.5 text-xs', active ? 'bg-primary-foreground/20' : 'bg-muted')}>
                    {formatNumber(count, 0)}
                  </span>
                </Link>
              );
            })}
          </nav>

          {attention.rows.length === 0 ? (
            <PanelEmpty
              icon={ClipboardList}
              title={attentionQuery.q ? 'No matching products' : 'Nothing in this list'}
              description={
                attentionQuery.q
                  ? 'Try a different name, SKU or barcode.'
                  : attentionQuery.status === 'ALL'
                    ? 'Add products to start tracking stock.'
                    : 'No products are in this state right now.'
              }
            />
          ) : (
            <>
              <AttentionTable rows={attention.rows} canAdjustStock={canAdjustStock} canEditProduct={canEditProduct} />
              <div className="border-t px-4 py-2.5">
                <PaginationBar page={attention.page} pageCount={attention.pageCount} total={attention.total} />
              </div>
            </>
          )}
        </div>
      </section>

      <RecentActivityPanel rows={data.recentActivity} />
    </>
  );
}

function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary hover:underline"
    >
      {children} <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_PILL: Record<'OUT' | 'LOW' | 'IN', { label: string; className: string; dot: string }> = {
  OUT: { label: 'Out of stock', className: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  LOW: { label: 'Low stock', className: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  IN: { label: 'In stock', className: 'bg-success/10 text-success', dot: 'bg-success' },
};

function bandOf(status: StockLevelRow['status']): 'OUT' | 'LOW' | 'IN' {
  if (status === 'OUT_OF_STOCK') return 'OUT';
  if (status === 'LOW' || status === 'CRITICAL') return 'LOW';
  return 'IN';
}

function StatusPill({ band }: { band: 'OUT' | 'LOW' | 'IN' }) {
  const meta = STATUS_PILL[band];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', meta.className)}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

function AttentionTable({
  rows,
  canAdjustStock,
  canEditProduct,
}: {
  rows: StockLevelRow[];
  canAdjustStock: boolean;
  canEditProduct: boolean;
}) {
  const head = 'h-10 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

  return (
    <>
      {/* Phones: one card per product. */}
      <ul className="divide-y sm:hidden">
        {rows.map((row) => {
          const band = bandOf(row.status);
          const threshold = row.reorderLevel > 0 ? row.reorderLevel : row.minStock;
          return (
            <li key={row.productId} className="flex items-start gap-3 p-4">
              <ProductImage src={row.imageUrl} alt={row.name} size="sm" className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Link href={`/products/${row.productId}`} className="block truncate text-sm font-semibold hover:underline">
                  {row.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {row.barcode ?? row.sku} · {row.categoryName}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="tabular font-semibold">{formatPieces(row.available)}</span>
                  {threshold > 0 && <span className="text-xs text-muted-foreground">reorder at {formatPieces(threshold)}</span>}
                  <StatusPill band={band} />
                </div>
              </div>
              <ProductRowActions
                productId={row.productId}
                productName={row.name}
                sku={row.sku}
                onHand={row.onHand}
                canAdjustStock={canAdjustStock}
                canEditProduct={canEditProduct}
                needsRestock={band !== 'IN'}
              />
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <Table className="min-w-[960px]">
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={head}>Product</TableHead>
              <TableHead className={head}>SKU / barcode</TableHead>
              <TableHead className={head}>Category</TableHead>
              <TableHead className={cn(head, 'text-right')}>Stock (pcs)</TableHead>
              <TableHead className={cn(head, 'text-right')}>Reorder at (pcs)</TableHead>
              <TableHead className={head}>Status</TableHead>
              <TableHead className={head}>Last movement</TableHead>
              <TableHead className={cn(head, 'text-right')}>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const band = bandOf(row.status);
              const threshold = row.reorderLevel > 0 ? row.reorderLevel : row.minStock;
              return (
                <TableRow key={row.productId}>
                  <TableCell className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <ProductImage src={row.imageUrl} alt={row.name} size="sm" className="h-10 w-10 shrink-0 rounded-lg" />
                      <Link
                        href={`/products/${row.productId}`}
                        className="block max-w-[16rem] truncate text-sm font-semibold hover:underline"
                      >
                        {row.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <p className="max-w-[11rem] truncate font-mono text-xs">{row.barcode ?? '—'}</p>
                    <p className="max-w-[11rem] truncate text-xs text-muted-foreground">{row.sku}</p>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-muted-foreground">{row.categoryName}</TableCell>
                  <TableCell
                    className={cn(
                      'tabular px-4 py-2.5 text-right text-sm font-semibold',
                      band === 'OUT' ? 'text-destructive' : band === 'LOW' ? 'text-warning' : '',
                    )}
                  >
                    {formatNumber(row.available, 0)}
                  </TableCell>
                  <TableCell className="tabular px-4 py-2.5 text-right text-sm text-muted-foreground">
                    {threshold > 0 ? formatNumber(threshold, 0) : '—'}
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <StatusPill band={band} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-2.5 text-sm text-muted-foreground">
                    {row.lastMovementAt ? (
                      <time dateTime={new Date(row.lastMovementAt).toISOString()} title={formatDateTime(row.lastMovementAt)}>
                        {formatRelative(row.lastMovementAt)}
                      </time>
                    ) : (
                      'None yet'
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right">
                    <ProductRowActions
                      productId={row.productId}
                      productName={row.name}
                      sku={row.sku}
                      onHand={row.onHand}
                      canAdjustStock={canAdjustStock}
                      canEditProduct={canEditProduct}
                      needsRestock={band !== 'IN'}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The products closest to (or past) their low-stock level, as a compact
 * ranking: each bar is stock left as a share of the level. A ranked list with
 * a bar beats a chart here — every row needs a name, numbers and an action.
 */
function ReorderPanel({
  rows,
  canAdjustStock,
  canEditProduct,
}: {
  rows: InventoryDashboardData['reorder'];
  canAdjustStock: boolean;
  canEditProduct: boolean;
}) {
  return (
    <Panel
      title="Closest to reorder level"
      description="Stock left against each product's low-stock level."
      action={<MoreLink href="/inventory?status=LOW_ANY">All low stock</MoreLink>}
    >
      {rows.length === 0 ? (
        <PanelEmpty
          icon={PackageCheck}
          title="Nothing near its reorder level"
          description="Products with a low-stock level appear here as they run down."
        />
      ) : (
        <ul className="divide-y">
          {rows.map((row) => {
            const percent = Math.max(0, Math.min(100, Math.round((row.available / row.threshold) * 100)));
            const out = row.available <= 0;
            return (
              <li key={row.productId} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/products/${row.productId}`} className="truncate text-sm font-medium hover:underline">
                      {row.name}
                    </Link>
                    <span className={cn('tabular shrink-0 text-sm font-semibold', out ? 'text-destructive' : 'text-warning')}>
                      {formatNumber(row.available, 0)}
                      <span className="font-normal text-muted-foreground"> / {formatPieces(row.threshold)}</span>
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${formatPieces(row.available)} of a ${formatPieces(row.threshold)} low-stock level`}
                  >
                    <div
                      className={cn('h-full rounded-full', out ? 'bg-destructive' : 'bg-warning')}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.suggested != null ? `Suggested restock: ${formatPieces(row.suggested)}` : 'No reorder quantity set'}
                  </p>
                </div>
                <ProductRowActions
                  productId={row.productId}
                  productName={row.name}
                  sku={row.sku}
                  onHand={row.available}
                  canAdjustStock={canAdjustStock}
                  canEditProduct={canEditProduct}
                  needsRestock
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function RecentActivityPanel({ rows }: { rows: InventoryDashboardData['recentActivity'] }) {
  return (
    <Panel
      title="Recent stock activity"
      description="The latest changes to stock, newest first."
      action={<MoreLink href="/inventory/movements">View all stock movements</MoreLink>}
    >
      {rows.length === 0 ? (
        <PanelEmpty icon={History} title="No stock movements yet" description="Receiving, selling and adjusting stock will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                {['Product', 'Movement', 'Quantity', 'Previous', 'New', 'When', 'By', 'Reference / reason'].map((label, i) => (
                  <TableHead
                    key={label}
                    className={cn(
                      'h-10 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                      i >= 2 && i <= 4 && 'text-right',
                    )}
                  >
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const inbound = row.quantity > 0;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="px-4 py-2.5">
                      <Link href={`/products/${row.productId}`} className="block max-w-[14rem] truncate text-sm font-medium hover:underline">
                        {row.productName}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-2.5 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {inbound ? (
                          <ArrowDownLeft className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                        )}
                        {MOVEMENT_LABEL[row.type]}
                      </span>
                    </TableCell>
                    <TableCell className={cn('tabular whitespace-nowrap px-4 py-2.5 text-right text-sm font-semibold', inbound ? 'text-success' : 'text-destructive')}>
                      {inbound ? '+' : ''}
                      {formatPieces(row.quantity)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right text-sm text-muted-foreground">
                      {formatNumber(row.balanceBefore, 0)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right text-sm font-medium">
                      {formatNumber(row.balanceAfter, 0)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-2.5 text-sm text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-2.5 text-sm text-muted-foreground">{row.userName}</TableCell>
                    <TableCell className="px-4 py-2.5 text-xs text-muted-foreground">
                      <span className="line-clamp-1 max-w-[16rem]">{row.note ?? row.referenceId ?? '—'}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
