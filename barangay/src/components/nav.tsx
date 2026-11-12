'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export type NavItem = { href: string; label: string };

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      <button type="button" className="btn-secondary md:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Menu
      </button>
      <nav className={`${open ? 'flex' : 'hidden'} w-full flex-col gap-1 md:flex md:w-auto md:flex-row md:flex-wrap`}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              active(item.href) ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
