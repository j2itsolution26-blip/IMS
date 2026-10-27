import { Boxes, ScanBarcode, ShieldCheck, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandLogo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { APP_NAME, VENDOR_NAME } from '@/lib/brand';

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ScanBarcode, title: 'Fast Checkout', text: 'Scan, total and print in seconds.' },
  { icon: Boxes, title: 'Smart Inventory', text: 'Know what is running low before it runs out.' },
  { icon: TrendingUp, title: 'Sales Insights', text: "See today's sales and best sellers at a glance." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* ── Branding panel (desktop only) ── */}
      <aside className="relative hidden w-[52%] overflow-hidden bg-[#0B1A2E] text-white lg:flex">
        {/* Emerald glow, kept low so text stays the focus. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(60% 50% at 0% 0%, rgba(16,185,129,0.22), transparent 70%),' +
              'radial-gradient(50% 45% at 100% 100%, rgba(34,197,94,0.16), transparent 70%),' +
              'radial-gradient(30% 25% at 85% 10%, rgba(245,158,11,0.08), transparent 70%)',
          }}
        />
        {/* Shelf-like grid that fades out towards the edges. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_80%)]"
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
          <BrandLogo
            priority
            sizes="(min-width: 1280px) 340px, 280px"
            className="w-[280px] drop-shadow-[0_12px_32px_rgba(0,0,0,0.35)] xl:w-[340px]"
          />

          <div>
            <h2 className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
              Your Store. <span className="text-emerald-400">Smarter.</span>
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
              Sell faster, track every item, and manage your tindahan in one simple system.
            </p>

            <ul className="mt-8 grid gap-3 xl:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm xl:flex-col"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            Secure sessions &bull; Role-based access for every account
          </p>
        </div>
      </aside>

      {/* ── Sign-in panel ── */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-background pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-4 sm:py-8">
          {/* Compact logo in place of the branding panel on small screens. */}
          <BrandLogo priority sizes="200px" className="mb-6 w-[180px] sm:w-[200px] lg:hidden" />

          <div className="w-full max-w-[440px] rounded-2xl border bg-card p-6 text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-8px_rgba(15,23,42,0.12)] sm:p-8 dark:shadow-none">
            {children}
          </div>
        </div>

        <footer className="flex flex-col items-center gap-0.5 text-center text-xs text-muted-foreground sm:flex-row sm:justify-center sm:gap-1.5">
          <span>
            &copy; {new Date().getFullYear()} {APP_NAME}
          </span>
          <span className="hidden sm:inline" aria-hidden="true">
            &middot;
          </span>
          <span>
            Developed by <span className="font-semibold tracking-wide text-foreground/80">{VENDOR_NAME}</span>
          </span>
        </footer>
      </main>
    </div>
  );
}
