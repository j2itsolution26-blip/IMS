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
  const px = size === 'lg' ? 64 : 40;
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
      {/* Emerald Midnight: midnight navy into deep emerald. Static layers only, no animation. */}
      <aside className="relative hidden w-[52%] overflow-hidden bg-gradient-to-br from-[#071B24] via-[#073a35] to-[#075E46] text-white lg:flex">
        {/* Restrained green light: behind the logo, and low on the panel. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(42% 32% at 24% 16%, rgba(34,197,94,0.22), transparent 72%),' +
              'radial-gradient(50% 40% at 92% 100%, rgba(34,197,94,0.14), transparent 72%),' +
              'radial-gradient(60% 50% at 100% 0%, rgba(7,27,36,0.55), transparent 70%)',
          }}
        />
        {/* Technical grid that fades out towards the edges. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.05] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_80%)]"
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
        {/* Faint flowing lines, like a checkout lane in motion; a few light points ride them. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 800 1000"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="auth-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#22C55E" stopOpacity="0" />
              <stop offset="0.5" stopColor="#22C55E" stopOpacity="0.35" />
              <stop offset="1" stopColor="#22C55E" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g fill="none" stroke="url(#auth-flow)" strokeWidth="1.2" opacity="0.6">
            <path d="M-40 640 C 180 560, 360 760, 560 660 S 860 560, 860 560" />
            <path d="M-40 700 C 200 620, 380 820, 580 720 S 860 620, 860 620" />
            <path d="M-40 760 C 220 690, 400 880, 600 790 S 860 690, 860 690" opacity="0.6" />
          </g>
          <g fill="#22C55E">
            <circle cx="180" cy="590" r="2" opacity="0.5" />
            <circle cx="560" cy="660" r="2.2" opacity="0.45" />
            <circle cx="400" cy="776" r="1.6" opacity="0.4" />
          </g>
        </svg>

        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col justify-between gap-10 p-10 xl:p-14">
          <div>
            <BrandLogo
              priority
              sizes="(min-width: 1280px) 320px, 270px"
              className="w-[270px] drop-shadow-[0_14px_32px_rgba(0,0,0,0.35)] xl:w-[320px]"
            />
          </div>

          <div>
            <h2 className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
              Your Store. <span className="text-[#4ADE80]">Smarter.</span>
            </h2>
            <span className="mt-4 block h-1 w-14 rounded-full bg-[#F4B942]" aria-hidden="true" />
            <p className="mt-4 max-w-md text-base leading-relaxed text-white/80">
              Sell faster, track every item, and manage your tindahan in one simple system.
            </p>

            <ul className="mt-8 grid gap-3 xl:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="group flex items-start gap-3 rounded-xl border border-emerald-300/15 bg-[#06352c]/55 p-4 backdrop-blur-sm transition-colors duration-200 hover:border-emerald-300/30 hover:bg-[#06352c]/75 xl:flex-col"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#22C55E]/15 text-[#4ADE80]">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/75">{text}</p>
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
      <main className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden bg-[#F1F5F9] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] dark:bg-background">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-4 sm:py-8">
          {/* The logo in place of the branding panel on small screens. */}
          <BrandLogo priority sizes="180px" className="mb-5 w-[150px] sm:mb-6 sm:w-[180px] lg:hidden" />

          <div className="w-full max-w-[440px] rounded-2xl border border-slate-200/70 bg-white p-6 text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-14px_rgba(15,23,42,0.16)] sm:p-8 dark:border-border dark:bg-card dark:shadow-none">
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
