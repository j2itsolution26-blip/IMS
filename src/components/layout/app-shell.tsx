'use client';

import * as React from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sidebar, type UserInfo } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { GlobalSearch } from '@/components/layout/global-search';
import { cn } from '@/lib/utils';

interface AppShellProps {
  permissions: string[];
  lowStockCount: number;
  companyName: string;
  user?: UserInfo;
  userSlot: React.ReactNode;
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
  companyName,
  user,
  userSlot,
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
    <div className="min-h-dvh bg-background text-foreground antialiased selection:bg-primary/20">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to content
      </a>

      <Sidebar
        permissions={permissions}
        lowStockCount={lowStockCount}
        companyName={companyName}
        user={user}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={mounted ? collapsed : false}
        onToggleCollapse={handleToggleCollapse}
      />

      <div
        className={cn(
          'flex flex-col min-h-dvh transition-all duration-300 ease-in-out',
          mounted && collapsed ? 'lg:pl-[4.25rem]' : 'lg:pl-64',
        )}
      >
        {/* Header / Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-2xs">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle variant="dropdown" />
            {userSlot}
          </div>
        </header>

        {/* Main Content Area */}
        <main id="main-content" className="flex-1 p-4 sm:p-6 transition-all duration-200">
          {children}
        </main>
      </div>
    </div>
  );
}
