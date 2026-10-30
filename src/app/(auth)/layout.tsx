import Image from 'next/image';
import { Boxes, ScanBarcode, ShieldCheck, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandLogo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { APP_NAME, VENDOR_LOGO, VENDOR_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ScanBarcode, title: 'Fast Checkout', text: 'Scan, total, and print in seconds.' },
  { icon: Boxes, title: 'Smart Inventory', text: 'Know what is running low before it runs out.' },
  { icon: TrendingUp, title: 'Sales Insights', text: "See today's sales and best sellers at a glance." },
];

/**
 * The company logo exactly as supplied: a square image on a white ground,
 * so it sits on a white tile rather than being cut out or recoloured.
 */
function VendorLogo({ size, className }: { size: 'sm' | 'lg'; className?: string }) {
  const px = size === 'lg' ? 72 : 40;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-black/5',
        size === 'lg' ? 'shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45)]' : 'shadow-sm',
        className,
      )}
    >
      <Image
        src={VENDOR_LOGO.src}
        width={VENDOR_LOGO.width}
        height={VENDOR_LOGO.height}
        alt={`${VENDOR_NAME} logo`}
        sizes={`${px}px`}
        style={{ width: px, height: px }}
        className="select-none object-contain"
        draggable={false}
      />
    </span>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-dvh">
      {/* ── Branding panel (desktop only) ── */}
      <aside className="relative hidden w-[52%] overflow-hidden bg-gradient-to-br from-[#04251c] via-[#063b33] to-[#0a3d4a] text-white lg:flex">
        {/* Soft emerald and teal light with a restrained touch of gold. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(55% 45% at 10% 5%, rgba(16,185,129,0.28), transparent 70%),' +
              'radial-gradient(45% 40% at 95% 95%, rgba(20,184,166,0.22), transparent 70%),' +
              'radial-gradient(28% 22% at 85% 12%, rgba(234,179,8,0.12), transparent 70%)',
          }}
        />
        {/* Shelf-like grid that fades out towards the edges. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_80%)]"
          aria-hidden="true"
        >
          <defs>
            <pattern id="auth-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="white" strokeWidth="1" />
              <circle cx="0" cy="0" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>

        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col justify-between gap-10 p-10 xl:p-14">
          <div>
            {/* The logo carries its own "POS & INVENTORY SYSTEM" line. */}
            <BrandLogo
              priority
              sizes="(min-width: 1280px) 320px, 270px"
              className="w-[270px] drop-shadow-[0_14px_36px_rgba(0,0,0,0.4)] xl:w-[320px]"
            />
          </div>

          <div>
            <h2 className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
              Your Store. <span className="text-emerald-300">Smarter.</span>
            </h2>
            <span className="mt-4 block h-1 w-14 rounded-full bg-amber-400/80" aria-hidden="true" />
            <p className="mt-4 max-w-md text-base leading-relaxed text-emerald-50/80">
              Sell faster, track every item, and manage your tindahan in one simple system.
            </p>

            <ul className="mt-8 grid gap-3 xl:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-sm transition-colors duration-200 hover:border-amber-300/40 hover:bg-white/[0.09] xl:flex-col"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300 transition-colors duration-200 group-hover:bg-amber-400/15 group-hover:text-amber-300">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-emerald-50/70">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Company branding, bottom left. */}
          <div className="flex items-end justify-between gap-6">
            <div className="flex items-center gap-4">
              <VendorLogo size="lg" />
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-50/60">Powered by</p>
                <p className="text-lg font-bold tracking-tight">{VENDOR_NAME}</p>
                <p className="text-xs text-emerald-50/60">Smart solutions. Secure futures.</p>
              </div>
            </div>
            <p className="hidden items-center gap-2 text-xs text-emerald-50/60 xl:flex">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              Role-based access for every account
            </p>
          </div>
        </div>
      </aside>

      {/* ── Sign-in panel ── */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-slate-100 pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] dark:bg-background">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-4 sm:py-8">
          {/* Compact logo in place of the branding panel on small screens. */}
          <BrandLogo priority sizes="200px" className="mb-6 w-[180px] sm:w-[200px] lg:hidden" />

          <div className="w-full max-w-[440px] rounded-2xl border border-slate-200/80 bg-card p-6 text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-12px_rgba(15,23,42,0.18)] sm:p-8 dark:border-border dark:shadow-none">
            {children}
          </div>
        </div>

        <footer className="flex flex-col items-center gap-2 text-center text-xs text-slate-500 dark:text-muted-foreground">
          {/* The company logo also appears here where the branding panel is hidden. */}
          <VendorLogo size="sm" className="lg:hidden" />
          <p>
            &copy; {year} {APP_NAME} <span aria-hidden="true">|</span> Powered by{' '}
            <span className="font-semibold text-slate-700 dark:text-foreground">{VENDOR_NAME}</span>
          </p>
        </footer>
      </main>
    </div>
  );
}
