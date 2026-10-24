'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, Lock, LogOut, Settings, User as UserIcon, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initials } from '@/lib/utils';
import { installActionAvailable } from '@/lib/pwa';
import { useScreenLock } from '@/features/auth/screen-lock';
import { SignOutDialog } from '@/features/auth/sign-out';
import { InstallAppDialog } from '@/features/pwa/install-app-dialog';
import { useInstallPlatform, useInstallState } from '@/features/pwa/install-state';

export interface AccountMenuUser {
  name: string;
  email: string;
  image: string | null;
  roleName: string;
}

interface AccountMenuProps {
  user: AccountMenuUser;
  canManageSettings: boolean;
  canManageStaff: boolean;
  /** The element that opens the menu (rendered with `asChild`). */
  children: React.ReactElement;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  /** Called before a link navigates, e.g. to close the mobile drawer. */
  onNavigate?: () => void;
}

/** Roomier rows than the default menu item, with quieter icons. */
const ITEM = 'gap-2.5 py-2 [&_svg]:text-muted-foreground';

/**
 * The account menu: who is signed in, and what they can do with the session.
 *
 * Opened from the header avatar and from the sidebar's account card. Both
 * render this one component, so the actions, the install check and the
 * sign-out confirmation cannot drift apart. Radix supplies outside-click and
 * Escape dismissal, arrow-key navigation, focus return and viewport collision.
 */
export function AccountMenu({
  user,
  canManageSettings,
  canManageStaff,
  children,
  side = 'bottom',
  align = 'end',
  onNavigate,
}: AccountMenuProps) {
  const screenLock = useScreenLock();
  const canInstall = installActionAvailable(useInstallState(), useInstallPlatform());
  const [installOpen, setInstallOpen] = React.useState(false);
  const [signOutOpen, setSignOutOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>

        <DropdownMenuContent
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className="w-72 max-w-[calc(100vw-1rem)] p-1.5 shadow-lg"
        >
          <div className="flex items-center gap-3 px-2 py-2.5">
            <Avatar className="h-10 w-10 shrink-0">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{user.name}</p>
              {user.email && <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>}
              <p className="mt-1.5 inline-flex max-w-full truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {user.roleName}
              </p>
            </div>
          </div>

          <DropdownMenuSeparator className="mx-0 bg-border" />

          <DropdownMenuGroup>
            {screenLock && (
              <DropdownMenuItem className={ITEM} onSelect={screenLock.lock}>
                <Lock /> Lock screen
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className={ITEM} asChild>
              <Link href="/settings/profile" onClick={onNavigate}>
                <UserIcon /> Profile
              </Link>
            </DropdownMenuItem>
            {canManageStaff && (
              <DropdownMenuItem className={ITEM} asChild>
                <Link href="/settings/users" onClick={onNavigate}>
                  <Users /> Staff Accounts
                </Link>
              </DropdownMenuItem>
            )}
            {canManageSettings && (
              <DropdownMenuItem className={ITEM} asChild>
                <Link href="/settings" onClick={onNavigate}>
                  <Settings /> Settings
                </Link>
              </DropdownMenuItem>
            )}
            {canInstall && (
              <DropdownMenuItem className={ITEM} onSelect={() => setInstallOpen(true)}>
                <Download /> Install app
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="mx-0 bg-border" />

          <DropdownMenuItem destructive className="gap-2.5 py-2" onSelect={() => setSignOutOpen(true)}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <InstallAppDialog open={installOpen} onOpenChange={setInstallOpen} />
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  );
}

interface UserMenuProps extends AccountMenuUser {
  canManageSettings: boolean;
  canManageStaff: boolean;
}

/** Header avatar that opens the account menu. */
export function UserMenu({ canManageSettings, canManageStaff, ...user }: UserMenuProps) {
  return (
    <AccountMenu user={user} canManageSettings={canManageSettings} canManageStaff={canManageStaff}>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 rounded-full data-[state=open]:ring-2 data-[state=open]:ring-primary/40"
        aria-label={`Account menu for ${user.name}`}
      >
        <Avatar className="h-8 w-8">
          {user.image && <AvatarImage src={user.image} alt="" />}
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
      </Button>
    </AccountMenu>
  );
}
