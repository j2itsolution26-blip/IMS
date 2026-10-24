'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  X,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { APP_NAME } from '@/lib/brand';
import { BrandMark } from '@/components/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/misc';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  NAVIGATION,
  isNavGroup,
  isNavLinkActive,
  navBadgeCount,
  visibleNavigation,
  type NavBadgeCounts,
  type NavGroup,
  type NavLink,
} from '@/components/layout/navigation';
import { AccountMenu } from '@/components/layout/user-menu';

export interface UserInfo {
  name: string;
  email: string;
  image: string | null;
  roleName: string;
}

interface SidebarProps {
  permissions: string[];
  lowStockCount: number;
  supportCount: number;
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
  supportCount,
  companyName,
  user,
  open,
  onClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const granted = React.useMemo(() => new Set(permissions), [permissions]);
  const counts = React.useMemo(() => ({ lowStock: lowStockCount, support: supportCount }), [lowStockCount, supportCount]);

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

  // Filter sections by user permissions (empty groups and sections are completely omitted)
  const sections = React.useMemo(() => visibleNavigation(NAVIGATION, granted), [granted]);

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
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          collapsed ? 'lg:w-[4.25rem]' : 'lg:w-64',
          'w-64', // Mobile drawer width is always 256px
          // Clear of the notch, landscape side insets and the home indicator.
          'pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]',
        )}
        aria-label="Main navigation"
      >
        {/* Brand Header.

            The logo never shrinks and the text column is allowed to (min-w-0),
            which is what lets a long store name truncate instead of pushing
            across the logo. Both lines are single-line: the name ellipsises,
            and the subtitle is never broken into "POINT OF" / "SALE". */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-3 transition-all duration-200',
            // The collapsed rail is 4.25rem; px-3 plus the link's padding would
            // leave only 36px, so the 40px logo needs the tighter inset there.
            collapsed ? 'lg:justify-center lg:px-2' : 'justify-between',
          )}
        >
          <Link
            href="/dashboard"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed && 'lg:flex-none lg:justify-center',
            )}
            onClick={onClose}
            title={companyName}
          >
            <BrandMark className="h-10 w-10 rounded-lg shadow-sm transition-transform hover:scale-105" />
            <div
              className={cn(
                'flex min-w-0 flex-col justify-center transition-opacity duration-200',
                collapsed ? 'lg:hidden' : 'flex',
              )}
            >
              <span className="truncate text-sm font-semibold leading-tight tracking-tight text-sidebar-foreground">
                {companyName}
              </span>
              <span className="truncate text-[10px] font-medium uppercase leading-tight tracking-wider text-sidebar-muted-foreground">
                {APP_NAME}
              </span>
            </div>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 lg:hidden text-sidebar-muted-foreground hover:text-sidebar-foreground"
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
                  'px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-sidebar-muted-foreground/70 transition-opacity duration-200 select-none',
                  collapsed ? 'lg:hidden' : 'block',
                )}
              >
                {section.label}
              </p>

              {/* Section divider when collapsed on desktop */}
              {collapsed && sIdx > 0 && (
                <div className="hidden lg:block my-2 mx-2 h-px bg-sidebar-border/60" />
              )}

              <ul className="space-y-1">
                {section.items.map((item) =>
                  isNavGroup(item) ? (
                    <NavGroupItem
                      key={item.label}
                      group={item}
                      pathname={pathname}
                      collapsed={collapsed}
                      counts={counts}
                      onNavigate={onClose}
                    />
                  ) : (
                    <NavLinkItem
                      key={item.href}
                      link={item}
                      active={isNavLinkActive(item, pathname)}
                      collapsed={collapsed}
                      count={navBadgeCount(item, counts)}
                      onNavigate={onClose}
                    />
                  ),
                )}
              </ul>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-sidebar-border p-2 space-y-2 shrink-0">
          {/* User info card — opens the account menu */}
          {user && (
            <AccountMenu
              user={user}
              canManageSettings={granted.has('settings.view')}
              canManageStaff={granted.has('users.view')}
              side="top"
              align="start"
              onNavigate={onClose}
            >
              <button
                type="button"
                aria-label={`Account menu for ${user.name}`}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-white/5 p-2 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  collapsed ? 'lg:justify-center lg:p-1.5 lg:border-none lg:bg-transparent' : 'justify-between',
                )}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Avatar className="h-8 w-8 border border-sidebar-accent/30 shrink-0">
                    {user.image && <AvatarImage src={user.image} alt="" />}
                    <AvatarFallback>{initials(user.name)}</AvatarFallback>
                  </Avatar>

                  <span
                    className={cn(
                      'flex flex-col min-w-0 transition-opacity duration-200',
                      collapsed ? 'lg:hidden' : 'flex',
                    )}
                  >
                    <span className="truncate text-xs font-semibold text-sidebar-foreground leading-tight">
                      {user.name}
                    </span>
                    <span className="mt-0.5 inline-block w-fit rounded-full bg-sidebar-accent/15 px-1.5 py-px text-[10px] font-medium text-sidebar-accent">
                      {user.roleName}
                    </span>
                  </span>
                </span>

                <ChevronsUpDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-sidebar-muted-foreground',
                    collapsed ? 'lg:hidden' : 'block',
                  )}
                  aria-hidden="true"
                />
              </button>
            </AccountMenu>
          )}

          {/* Collapse/Expand Toggle button (desktop only). The theme lives in
              the header's single control, not here. */}
          <div className="hidden lg:flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className={cn(
                'w-full text-xs text-sidebar-muted-foreground hover:text-sidebar-foreground flex items-center gap-2 h-8',
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

const ROW = 'relative flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const ROW_IDLE = 'text-sidebar-muted-foreground hover:bg-white/5 hover:text-sidebar-foreground';
const ROW_ACTIVE = 'bg-sidebar-accent/15 text-sidebar-foreground font-semibold';

function CountBadge({ count, collapsed }: { count: number; collapsed?: boolean }) {
  if (count <= 0) return null;
  return (
    <Badge
      variant="warning"
      className={cn(
        'px-1.5 py-0 text-[10px] font-bold',
        collapsed ? 'lg:absolute lg:-top-1 lg:-right-1 lg:h-4 lg:min-w-4 lg:p-0 lg:flex lg:items-center lg:justify-center' : '',
      )}
    >
      {count > 99 ? '99+' : count}
    </Badge>
  );
}

/** One top-level link, or — with `nested` — a child inside an open group. */
function NavLinkItem({
  link,
  active,
  collapsed,
  count,
  onNavigate,
  nested = false,
}: {
  link: NavLink;
  active: boolean;
  collapsed: boolean;
  count: number;
  onNavigate: () => void;
  nested?: boolean;
}) {
  // A nested child only renders in the expanded layout, so the rail rules skip it.
  const rail = collapsed && !nested;

  const linkContent = (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        ROW,
        nested && 'py-1.5 text-[13px]',
        rail ? 'lg:justify-center lg:px-2' : 'justify-start',
        active ? ROW_ACTIVE : ROW_IDLE,
      )}
    >

      <link.icon
        className={cn('h-4 w-4 shrink-0 transition-colors', active ? 'text-sidebar-accent' : 'text-sidebar-muted-foreground')}
        aria-hidden="true"
      />

      <span className={cn('flex-1 truncate transition-opacity duration-200', rail ? 'lg:hidden' : 'inline')}>
        {link.label}
      </span>

      <CountBadge count={count} collapsed={rail} />
    </Link>
  );

  if (rail) {
    return (
      <li>
        <div className="hidden lg:block">
          <Tooltip>
            <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2 font-medium">
              <span>{link.label}</span>
              {count > 0 && (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
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

  return <li>{linkContent}</li>;
}

/**
 * An expandable parent such as Products. It opens by itself whenever one of
 * its pages is showing, and the reader can fold it away again. On the
 * collapsed desktop rail there is no room for a nested list, so the icon
 * opens the children as a flyout menu instead.
 */
function NavGroupItem({
  group,
  pathname,
  collapsed,
  counts,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  counts: NavBadgeCounts;
  onNavigate: () => void;
}) {
  const listId = React.useId();
  const childActive = group.children.some((child) => isNavLinkActive(child, pathname));
  const [expanded, setExpanded] = React.useState(childActive);

  // Arriving on a child page (by link, search or back button) opens the group.
  React.useEffect(() => {
    if (childActive) setExpanded(true);
  }, [childActive]);

  const countFor = (link: NavLink) => navBadgeCount(link, counts);
  const groupCount = group.children.reduce((sum, child) => sum + countFor(child), 0);

  const expandable = (
    <>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={listId}
        className={cn(ROW, 'justify-start', childActive ? 'text-sidebar-foreground font-semibold' : ROW_IDLE)}
      >
        <group.icon
          className={cn('h-4 w-4 shrink-0', childActive ? 'text-sidebar-accent' : 'text-sidebar-muted-foreground')}
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-left">{group.label}</span>
        {/* Once open, the count sits on the child it belongs to. */}
        {!expanded && <CountBadge count={groupCount} />}
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-150', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <ul id={listId} className="mt-1 ml-[1.15rem] space-y-0.5 border-l border-sidebar-border pl-2">
          {group.children.map((child) => (
            <NavLinkItem
              key={child.href}
              link={child}
              active={isNavLinkActive(child, pathname)}
              collapsed={collapsed}
              count={countFor(child)}
              onNavigate={onNavigate}
              nested
            />
          ))}
        </ul>
      )}
    </>
  );

  if (!collapsed) return <li>{expandable}</li>;

  return (
    <li>
      <div className="hidden lg:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={group.label}
              className={cn(ROW, 'justify-center px-2', childActive ? ROW_ACTIVE : ROW_IDLE)}
            >
              <group.icon
                className={cn('h-4 w-4 shrink-0', childActive ? 'text-sidebar-accent' : 'text-sidebar-muted-foreground')}
                aria-hidden="true"
              />
              <CountBadge count={groupCount} collapsed />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {group.children.map((child) => {
              const active = isNavLinkActive(child, pathname);
              const count = countFor(child);
              return (
                <DropdownMenuItem key={child.href} asChild>
                  <Link
                    href={child.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(active && 'font-semibold text-primary')}
                  >
                    <child.icon /> <span className="flex-1">{child.label}</span>
                    {count > 0 && (
                      <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                        {count > 99 ? '99+' : count}
                      </Badge>
                    )}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="block lg:hidden">{expandable}</div>
    </li>
  );
}
