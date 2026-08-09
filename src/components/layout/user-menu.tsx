'use client';

import * as React from 'react';
import Link from 'next/link';
import { LogOut, Settings, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage, Separator } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';
import { initials } from '@/lib/utils';

interface UserMenuProps {
  name: string;
  email: string;
  image: string | null;
  roleName: string;
  canManageSettings: boolean;
}

export function UserMenu({ name, email, image, roleName, canManageSettings }: UserMenuProps) {
  const [signingOut, setSigningOut] = React.useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
      // Full navigation rather than router.push so every cached server
      // component tied to the old session is discarded.
      window.location.href = '/sign-in';
    } catch {
      toast.error('Could not sign out. Please try again.');
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account menu for ${name}`}>
          <Avatar className="h-8 w-8">
            {image && <AvatarImage src={image} alt="" />}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          <p className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {roleName}
          </p>
        </div>
        <Separator className="my-1" />

        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserIcon /> Profile
          </Link>
        </DropdownMenuItem>

        {canManageSettings && (
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
        )}

        <Separator className="my-1" />
        <DropdownMenuItem
          destructive
          onSelect={(event) => {
            event.preventDefault();
            void onSignOut();
          }}
          disabled={signingOut}
        >
          <LogOut /> {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
