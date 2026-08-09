'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

const schema = z.object({
  email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

type FormValues = z.infer<typeof schema>;

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });

    if (error) {
      // Never distinguish "no such user" from "wrong password" — that turns the
      // login form into an account enumeration oracle.
      setFormError(
        error.status === 401 || error.status === 403
          ? 'Those credentials are not valid.'
          : error.message || 'Sign in failed. Please try again.',
      );
      return;
    }

    // Hard navigation so the new session cookie is picked up by every
    // server component on the destination page.
    window.location.href = redirectTo.startsWith('/') ? redirectTo : '/dashboard';
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {/* ── Form-level error ── */}
      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 p-3.5 text-sm text-destructive dark:bg-destructive/15"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* ── Email field ── */}
      <div className="space-y-2">
        <Label htmlFor="email" className="text-sm font-medium">
          Email address
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Mail className="h-4 w-4" />
          </span>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="Enter your email address"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : undefined}
            className={cn(
              'flex h-12 w-full rounded-lg border border-input bg-transparent pl-10 pr-4 text-sm shadow-sm transition-colors',
              'placeholder:text-muted-foreground/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              errors.email && 'border-destructive focus-visible:ring-destructive',
            )}
            {...register('email')}
          />
        </div>
        {errors.email && (
          <p id="email-error" className="text-xs text-destructive" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* ── Password field ── */}
      <div className="space-y-2">
        <Label htmlFor="password" className="text-sm font-medium">
          Password
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Lock className="h-4 w-4" />
          </span>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Enter your password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
            className={cn(
              'flex h-12 w-full rounded-lg border border-input bg-transparent pl-10 pr-12 text-sm shadow-sm transition-colors',
              'placeholder:text-muted-foreground/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              errors.password && 'border-destructive focus-visible:ring-destructive',
            )}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && (
          <p id="password-error" className="text-xs text-destructive" role="alert">
            {errors.password.message}
          </p>
        )}
      </div>

      {/* ── Remember me row ── */}
      <div className="flex items-center">
        <button
          type="button"
          role="checkbox"
          aria-checked={rememberMe}
          onClick={() => setRememberMe((prev) => !prev)}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            rememberMe
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input',
          )}
        >
          {rememberMe && (
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <label
          className="ml-2 cursor-pointer select-none text-sm text-muted-foreground"
          onClick={() => setRememberMe((prev) => !prev)}
        >
          Remember me
        </label>
      </div>

      {/* ── Submit button ── */}
      <Button
        type="submit"
        className="h-12 w-full rounded-lg text-sm font-medium"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          'Sign In'
        )}
      </Button>
    </form>
  );
}
