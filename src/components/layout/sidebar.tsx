'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, initials } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/misc';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme-toggle';
import { NAVIGATION } from '@/components/layout/navigation';
import { authClient } from '@/lib/auth-client';
import type { PermissionKey } from '@/lib/permissions';

export interface UserInfo {
  name: string;
  email: string;
  image: string | null;
  roleName: string;
}

interface SidebarProps {
  permissions: string[];
  lowStockCount: number;
  unreadCount: number;
  companyName: string;
  user?: UserInfo;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  permissions,
  lowStockCount,
  unreadCount,
  companyName,
  user,
  open,
  onClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = React.useState(false);
  const granted = React.useMemo(() => new Set(permissions), [permissions]);

  // Escape key handler to close mobile navigation drawer
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Filter sections by user permissions (empty sections are completely omitted)
  const sections = React.useMemo(
    () =>
      NAVIGATION.map((section) => ({
        ...section,
        items: section.items.filter((item) => granted.has(item.permission as PermissionKey)),
      })).filter((section) => section.items.length > 0),
    [granted],
  );

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
      window.location.href = '/sign-in';
    } catch {
      toast.error('Could not sign out. Please try again.');
      setSigningOut(false);
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      {/* Mobile Backdrop / Scrim */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300 ease-in-out',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          collapsed ? 'lg:w-[4.25rem]' : 'lg:w-64',
          'w-64', // Mobile drawer width is always 256px
        )}
        aria-label="Main navigation"
      >
        {/* Brand Header */}
        <div
          className={cn(
            'flex h-14 items-center border-b px-3 shrink-0 transition-all duration-200',
            collapsed ? 'lg:justify-center' : 'justify-between',
          )}
        >
          <Link
            href="/dashboard"
            className={cn('flex items-center gap-2.5 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg p-1', collapsed && 'lg:justify-center')}
            onClick={onClose}
            title={companyName}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105">
              <Boxes className="h-5 w-5" />
            </span>
            <div
              className={cn(
                'flex flex-col min-w-0 transition-opacity duration-200',
                collapsed ? 'lg:hidden' : 'block',
              )}
            >
              <span className="truncate text-sm font-semibold tracking-tight leading-tight text-foreground">
                {companyName}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Enterprise IMS
              </span>
            </div>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Scrollable Navigation Area */}
        <nav className="flex-1 space-y-4 overflow-y-auto scrollbar-thin px-2 py-3">
          {sections.map((section, sIdx) => (
            <div key={section.label} className={cn(sIdx > 0 && 'pt-1')}>
              {/* Section title (hidden when collapsed on desktop) */}
              <p
                className={cn(
                  'px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 transition-opacity duration-200 select-none',
                  collapsed ? 'lg:hidden' : 'block',
                )}
              >
                {section.label}
              </p>

              {/* Section divider when collapsed on desktop */}
              {collapsed && sIdx > 0 && (
                <div className="hidden lg:block my-2 mx-2 h-px bg-border/60" />
              )}

              <ul className="space-y-1">
                {section.items.map((item) => {
                  const active = isActive(item.href, item.exact);
                  const count =
                    item.badge === 'lowStock' ? lowStockCount : item.badge === 'notifications' ? unreadCount : 0;

                  const linkContent = (
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        collapsed ? 'lg:justify-center lg:px-2' : 'justify-start',
                        active
                          ? 'bg-primary/10 text-primary font-semibold shadow-xs'
                          : 'text-muted-foreground hover:bg-accent/80 hover:text-foreground',
                      )}
                    >
                      {/* Active indicator bar */}
                      {active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-primary" />
                      )}

                      <item.icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                        )}
                        aria-hidden="true"
                      />

                      <span
                        className={cn(
                          'flex-1 truncate transition-opacity duration-200',
                          collapsed ? 'lg:hidden' : 'inline',
                        )}
                      >
                        {item.label}
                      </span>

                      {/* Badge indicator */}
                      {count > 0 && (
                        <Badge
                          variant={item.badge === 'lowStock' ? 'warning' : 'destructive'}
                          className={cn(
                            'px-1.5 py-0 text-[10px] font-bold shadow-xs',
                            collapsed ? 'lg:absolute lg:-top-1 lg:-right-1 lg:h-4 lg:min-w-4 lg:p-0 lg:flex lg:items-center lg:justify-center' : '',
                          )}
                        >
                          {count > 99 ? '99+' : count}
                        </Badge>
                      )}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <li key={item.href}>
                        <div className="hidden lg:block">
                          <Tooltip>
                            <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                            <TooltipContent side="right" className="flex items-center gap-2 font-medium">
                              <span>{item.label}</span>
                              {count > 0 && (
                                <Badge
                                  variant={item.badge === 'lowStock' ? 'warning' : 'destructive'}
                                  className="px-1.5 py-0 text-[10px]"
                                >
                                  {count}
                                </Badge>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="block lg:hidden">{linkContent}</div>
                      </li>
                    );
                  }

                  return <li key={item.href}>{linkContent}</li>;
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t p-2 space-y-2 bg-card/50 shrink-0">
          {/* User info card */}
          {user && (
            <div
              className={cn(
                'flex items-center gap-2.5 rounded-lg border bg-background/60 p-2 shadow-2xs transition-all',
                collapsed ? 'lg:justify-center lg:p-1.5 lg:border-none lg:bg-transparent' : 'justify-between',
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="h-8 w-8 border border-primary/20 shrink-0">
                  {user.image && <AvatarImage src={user.image} alt={user.name} />}
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>

                <div
                  className={cn(
                    'flex flex-col min-w-0 transition-opacity duration-200',
                    collapsed ? 'lg:hidden' : 'block',
                  )}
                >
                  <p className="truncate text-xs font-semibold text-foreground leading-tight">{user.name}</p>
                  <span className="mt-0.5 inline-block w-fit rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary">
                    {user.roleName}
                  </span>
                </div>
              </div>

              {/* Quick Sign out button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className={cn(
                      'h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                      collapsed ? 'lg:hidden' : 'flex',
                    )}
                    aria-label="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Theme switcher control in expanded view */}
          <div className={cn(collapsed ? 'lg:hidden' : 'block')}>
            <ThemeToggle variant="segmented" />
          </div>

          {/* Collapse/Expand Toggle button (desktop only) */}
          <div className="hidden lg:flex items-center justify-between pt-1 border-t border-border/40">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className={cn(
                'w-full text-xs text-muted-foreground hover:text-foreground flex items-center gap-2 h-8',
                collapsed ? 'justify-center px-0' : 'justify-start px-2.5',
              )}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </>
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 shrink-0" />
                  <span>Collapse sidebar</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
