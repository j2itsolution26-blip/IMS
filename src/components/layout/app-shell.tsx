'use client';

import * as React from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { APP_NAME } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { Sidebar, type UserInfo } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { GlobalSearch } from '@/components/layout/global-search';
import { LockScreenButton, ScreenLockProvider } from '@/features/auth/screen-lock';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { OfflineBanner } from '@/features/pwa/offline-banner';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface AppShellProps {
  permissions: string[];
  lowStockCount: number;
  /** Unread support replies (store accounts) or tickets awaiting an answer (administrators). */
  supportCount: number;
  /** Owner payments awaiting verification (administrators only). */
  paymentsCount: number;
  companyName: string;
  user?: UserInfo;
  userSlot: React.ReactNode;
  /** Who the lock screen is for, and the optional idle auto-lock (0 = off). */
  screenLock: { user: { name: string; username: string; hasPin: boolean }; autoLockMinutes: number };
  children: React.ReactNode;
}

const COLLAPSED_STORAGE_KEY = 'ims-sidebar-collapsed';

/**
 * Client shell around the server-rendered page content.
 *
 * Provides responsive sidebar drawer, collapsible icon-rail mode, theme persistence,
 * search shortcut, and notification integration.
 */
export function AppShell({
  permissions,
  lowStockCount,
  supportCount,
  paymentsCount,
  companyName,
  user,
  userSlot,
  screenLock,
  children,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  // Restore collapsed state from localStorage on mount
  React.useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (saved !== null) {
        setCollapsed(saved === 'true');
      }
    } catch {
      // Local storage unavailable or restricted
    }
  }, []);

  const handleToggleCollapse = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Local storage unavailable
      }
      return next;
    });
  }, []);

  return (
    <ScreenLockProvider user={screenLock.user} autoLockMinutes={screenLock.autoLockMinutes}>
    <div className="min-h-dvh bg-background text-foreground antialiased selection:bg-primary/20">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to content
      </a>

      <div className="no-print">
      <Sidebar
        permissions={permissions}
        lowStockCount={lowStockCount}
        supportCount={supportCount}
        paymentsCount={paymentsCount}
        companyName={companyName}
        user={user}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={mounted ? collapsed : false}
        onToggleCollapse={handleToggleCollapse}
      />
      </div>

      <div
        className={cn(
          'flex flex-col min-h-dvh transition-all duration-300 ease-in-out print:!pl-0',
          mounted && collapsed ? 'lg:pl-[4.25rem]' : 'lg:pl-64',
        )}
      >
        {/* Header / Top bar, with the connection notice pinned beneath it.
            Safe-area padding keeps it clear of notches in the installed app. */}
        <div className="sticky top-0 z-30">
        <header className="no-print flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b bg-card/95 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-card/85 shadow-2xs sm:gap-3 sm:pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))]">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* The sidebar carries the brand on desktop; below lg it is a drawer. */}
          <Link
            href="/dashboard"
            className="hidden shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block lg:hidden"
            aria-label={`${APP_NAME} dashboard`}
          >
            <BrandMark className="h-8 w-8 rounded-md" />
          </Link>

          <GlobalSearch />

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
            {/* Administrators get platform notifications; store owners their store's.
                The server decides which from the account, never from this choice. */}
            {permissions.includes('platform.view') ? (
              <NotificationBell viewAllHref="/system-admin/notifications" />
            ) : permissions.includes(FINANCIAL_PERMISSION) ? (
              // Shift alerts are time-sensitive, so the owner's bell checks more often.
              <NotificationBell viewAllHref="/notifications" pollMs={60_000} />
            ) : null}
            <LockScreenButton />
            <ThemeToggle />
            {userSlot}
          </div>
        </header>
        <OfflineBanner />
        </div>

        {/* Main Content Area */}
        <main
          id="main-content"
          className="flex-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] transition-all duration-200 sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"
        >
          {children}
        </main>
      </div>
    </div>
    </ScreenLockProvider>
  );
}
