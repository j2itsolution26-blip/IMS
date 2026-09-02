import { Boxes, BarChart3, Package, TrendingUp, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* ── Left branding panel ── */}
      <div className="relative hidden w-[55%] overflow-hidden bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] lg:flex lg:flex-col lg:justify-between">
        {/* Subtle grid pattern overlay */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.04]"
          aria-hidden="true"
        >
          <defs>
            <pattern id="auth-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>

        {/* Decorative gradient blobs */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-blue-600/8 blur-3xl" />

        {/* Top: Brand */}
        <div className="relative z-10 p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
              <Boxes className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">
              Point of Sale
            </span>
          </div>
        </div>

        {/* Center: Hero illustration + messaging */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-10">
          {/* Illustration */}
          <div className="mb-10 w-full max-w-md">
            <AuthIllustration />
          </div>

          {/* Value proposition */}
          <div className="w-full max-w-md text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white xl:text-3xl">
              Manage inventory with confidence
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-400">
              Track stock, monitor products, and make better business decisions from one
              centralized platform.
            </p>
          </div>

          {/* Feature pills */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <FeaturePill icon={<Package className="h-3.5 w-3.5" />} text="Stock Tracking" />
            <FeaturePill icon={<BarChart3 className="h-3.5 w-3.5" />} text="Analytics" />
            <FeaturePill icon={<TrendingUp className="h-3.5 w-3.5" />} text="Sales Insights" />
          </div>
        </div>

        {/* Bottom: Trust footer */}
        <div className="relative z-10 p-10">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Enterprise-grade security &bull; Encrypted data at rest</span>
          </div>
        </div>
      </div>

      {/* ── Right auth panel ── */}
      <div className="relative flex w-full flex-col bg-background lg:w-[45%]">
        {/* Theme toggle */}
        <div className="flex justify-end p-4 lg:p-6">
          <ThemeToggle />
        </div>

        {/* Auth form — centered */}
        <div className="flex flex-1 flex-col items-center justify-center px-5 pb-8 sm:px-8">
          <div className="w-full max-w-[440px]">
            {children}
          </div>
        </div>

        {/* Secure footer */}
        <div className="flex items-center justify-center gap-1.5 pb-6 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Secure access &bull; Point of Sale</span>
        </div>
      </div>
    </div>
  );
}

/* ── Feature pill ── */
function FeaturePill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur-sm">
      {icon}
      {text}
    </span>
  );
}

/* ── Warehouse / Inventory SVG illustration ── */
function AuthIllustration() {
  return (
    <svg
      viewBox="0 0 400 260"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full drop-shadow-2xl"
      aria-hidden="true"
    >
      {/* Background card */}
      <rect x="20" y="20" width="360" height="220" rx="16" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.08" />

      {/* Warehouse shelves */}
      {/* Shelf 1 */}
      <rect x="50" y="60" width="120" height="6" rx="2" fill="white" fillOpacity="0.12" />
      {/* Boxes on shelf 1 */}
      <rect x="55" y="36" width="22" height="22" rx="4" fill="#3B82F6" fillOpacity="0.6" />
      <rect x="82" y="40" width="18" height="18" rx="3" fill="#3B82F6" fillOpacity="0.4" />
      <rect x="105" y="34" width="24" height="24" rx="4" fill="#60A5FA" fillOpacity="0.5" />
      <rect x="134" y="42" width="16" height="16" rx="3" fill="#3B82F6" fillOpacity="0.35" />

      {/* Shelf 2 */}
      <rect x="50" y="110" width="120" height="6" rx="2" fill="white" fillOpacity="0.12" />
      {/* Boxes on shelf 2 */}
      <rect x="55" y="86" width="20" height="22" rx="4" fill="#60A5FA" fillOpacity="0.45" />
      <rect x="80" y="90" width="26" height="18" rx="3" fill="#3B82F6" fillOpacity="0.5" />
      <rect x="112" y="84" width="20" height="24" rx="4" fill="#3B82F6" fillOpacity="0.3" />
      <rect x="138" y="92" width="18" height="16" rx="3" fill="#60A5FA" fillOpacity="0.4" />

      {/* Shelf 3 */}
      <rect x="50" y="160" width="120" height="6" rx="2" fill="white" fillOpacity="0.12" />
      {/* Boxes on shelf 3 */}
      <rect x="58" y="136" width="24" height="22" rx="4" fill="#3B82F6" fillOpacity="0.45" />
      <rect x="88" y="140" width="18" height="18" rx="3" fill="#60A5FA" fillOpacity="0.35" />
      <rect x="112" y="138" width="22" height="20" rx="4" fill="#3B82F6" fillOpacity="0.55" />

      {/* Shelf posts */}
      <rect x="50" y="36" width="4" height="130" rx="2" fill="white" fillOpacity="0.08" />
      <rect x="166" y="36" width="4" height="130" rx="2" fill="white" fillOpacity="0.08" />

      {/* ── Dashboard / chart area ── */}
      {/* Chart card */}
      <rect x="200" y="36" width="160" height="100" rx="10" fill="white" fillOpacity="0.06" stroke="white" strokeOpacity="0.08" />

      {/* Mini bar chart */}
      <rect x="220" y="98" width="14" height="24" rx="3" fill="#3B82F6" fillOpacity="0.7" />
      <rect x="240" y="82" width="14" height="40" rx="3" fill="#3B82F6" fillOpacity="0.9" />
      <rect x="260" y="90" width="14" height="32" rx="3" fill="#60A5FA" fillOpacity="0.6" />
      <rect x="280" y="72" width="14" height="50" rx="3" fill="#3B82F6" fillOpacity="0.8" />
      <rect x="300" y="60" width="14" height="62" rx="3" fill="#60A5FA" fillOpacity="0.7" />
      <rect x="320" y="78" width="14" height="44" rx="3" fill="#3B82F6" fillOpacity="0.5" />

      {/* Chart label */}
      <rect x="216" y="46" width="60" height="8" rx="4" fill="white" fillOpacity="0.15" />
      <rect x="216" y="58" width="40" height="6" rx="3" fill="white" fillOpacity="0.08" />

      {/* ── Stock indicator cards ── */}
      {/* Card 1 */}
      <rect x="200" y="150" width="74" height="48" rx="8" fill="white" fillOpacity="0.06" stroke="white" strokeOpacity="0.08" />
      <rect x="212" y="162" width="32" height="6" rx="3" fill="white" fillOpacity="0.15" />
      <rect x="212" y="174" width="48" height="10" rx="4" fill="#22C55E" fillOpacity="0.5" />

      {/* Card 2 */}
      <rect x="286" y="150" width="74" height="48" rx="8" fill="white" fillOpacity="0.06" stroke="white" strokeOpacity="0.08" />
      <rect x="298" y="162" width="28" height="6" rx="3" fill="white" fillOpacity="0.15" />
      <rect x="298" y="174" width="48" height="10" rx="4" fill="#3B82F6" fillOpacity="0.5" />

      {/* ── Floating product card ── */}
      <rect x="60" y="180" width="100" height="44" rx="8" fill="white" fillOpacity="0.06" stroke="white" strokeOpacity="0.1" />
      <rect x="72" y="190" width="14" height="14" rx="4" fill="#60A5FA" fillOpacity="0.4" />
      <rect x="92" y="191" width="50" height="5" rx="2.5" fill="white" fillOpacity="0.15" />
      <rect x="92" y="200" width="36" height="5" rx="2.5" fill="white" fillOpacity="0.08" />
      <circle cx="152" cy="197" r="3" fill="#22C55E" fillOpacity="0.6" />
    </svg>
  );
}
