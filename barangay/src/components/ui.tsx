import Link from 'next/link';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-brand-100 text-brand-800',
} as const;

export function Badge({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Stat({ label, value, href, note }: { label: string; value: React.ReactNode; href?: string; note?: string }) {
  const body = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-600">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Notice({ tone = 'blue', children }: { tone?: 'blue' | 'red' | 'green'; children: React.ReactNode }) {
  const cls = {
    blue: 'border-brand-100 bg-brand-50 text-brand-900',
    red: 'border-red-200 bg-red-50 text-red-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }[tone];
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
