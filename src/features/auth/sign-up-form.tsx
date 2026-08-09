'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/**
 * Reusable single validation function for password rules.
 * Evaluated live on every input event (character-by-character).
 */
export function validatePassword(password: string) {
  const minLength = password.length >= 10;
  const uppercase = /[A-Z]/.test(password);
  const lowercase = /[a-z]/.test(password);
  const number = /[0-9]/.test(password);
  const specialCharacter = /[^A-Za-z0-9]/.test(password);
  const isValid = minLength && uppercase && lowercase && number && specialCharacter;

  const metCount = [minLength, uppercase, lowercase, number, specialCharacter].filter(Boolean).length;

  return {
    minLength,
    uppercase,
    lowercase,
    number,
    specialCharacter,
    isValid,
    metCount,
  };
}

/** Zod schema for client-side form validation. */
const schema = z
  .object({
    name: z.string().min(2, 'Enter your full name.').max(80),
    email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
    password: z.string().refine((val) => validatePassword(val).isValid, {
      message: 'Password must satisfy all requirements.',
    }),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function SignUpForm() {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSuccess, setIsSuccess] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);

  // Dedicated React state for instant, character-by-character live validation
  const [passwordValue, setPasswordValue] = React.useState('');
  const [confirmPasswordValue, setConfirmPasswordValue] = React.useState('');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
    mode: 'onChange',
  });

  const nameValue = watch('name') || '';
  const emailValue = watch('email') || '';

  // ── Single-Source-Of-Truth Live Character-by-Character Password Analysis ──
  const passwordAnalysis = React.useMemo(() => {
    return validatePassword(passwordValue);
  }, [passwordValue]);

  // ── Password Requirement Items ──
  const passwordRequirements = React.useMemo(() => {
    return [
      {
        id: 'length',
        label: 'At least 10 characters',
        isMet: passwordAnalysis.minLength,
      },
      {
        id: 'uppercase',
        label: 'One uppercase letter',
        isMet: passwordAnalysis.uppercase,
      },
      {
        id: 'lowercase',
        label: 'One lowercase letter',
        isMet: passwordAnalysis.lowercase,
      },
      {
        id: 'number',
        label: 'One number',
        isMet: passwordAnalysis.number,
      },
      {
        id: 'special',
        label: 'One special character',
        isMet: passwordAnalysis.specialCharacter,
      },
    ];
  }, [passwordAnalysis]);

  // ── Password Strength Calculation ──
  const strengthInfo = React.useMemo(() => {
    if (!passwordValue) {
      return { label: '', color: '', width: '0%' };
    }
    if (passwordAnalysis.metCount <= 2) {
      return { label: 'Weak', color: 'bg-destructive', width: '25%' };
    }
    if (passwordAnalysis.metCount <= 4) {
      return { label: 'Moderate', color: 'bg-amber-500', width: '50%' };
    }
    // 5 rules met
    const isExtraStrong =
      passwordValue.length >= 14 ||
      (passwordValue.match(/[^A-Za-z0-9]/g) || []).length >= 2 ||
      (passwordValue.match(/[0-9]/g) || []).length >= 2;

    if (isExtraStrong) {
      return { label: 'Very Strong', color: 'bg-emerald-600', width: '100%' };
    }
    return { label: 'Strong', color: 'bg-blue-600', width: '75%' };
  }, [passwordValue, passwordAnalysis.metCount]);

  // ── Form Validity State ──
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim());
  const passwordsMatch =
    confirmPasswordValue.length > 0 && confirmPasswordValue === passwordValue;
  const isFormValid =
    passwordAnalysis.isValid &&
    passwordsMatch &&
    nameValue.trim().length >= 2 &&
    isEmailValid;

  // Registered input handlers
  const passwordRegister = register('password');
  const confirmPasswordRegister = register('confirmPassword');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const { error } = await authClient.signUp.email({
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      password: values.password,
    });

    if (error) {
      const errorMsg = error.message || 'Could not create the account. Please try again.';
      setFormError(errorMsg);
      toast.error('Unable to create account', {
        description: errorMsg,
      });
      return;
    }

    setIsSuccess(true);
    toast.success('Account created successfully', {
      description: 'Your owner account has been created successfully.',
      duration: 4000,
    });

    // Pause briefly so user can read confirmation toast before redirecting to login
    setTimeout(() => {
      window.location.href = '/sign-in';
    }, 1500);
  });

  const inputBase = cn(
    'flex h-12 w-full rounded-lg border border-input bg-transparent pl-10 pr-4 text-sm shadow-sm transition-colors',
    'placeholder:text-muted-foreground/60',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:cursor-not-allowed disabled:opacity-50',
  );

  const inputWithToggle = cn(inputBase, 'pr-12');

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {/* ── Success banner ── */}
      {isSuccess && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold leading-none">Account created successfully</p>
            <p className="text-sm text-emerald-600/90 dark:text-emerald-400/90">
              Your owner account is ready. Redirecting to sign in page…
            </p>
          </div>
        </div>
      )}

      {/* ── Form-level error banner ── */}
      {formError && !isSuccess && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 p-3.5 text-sm text-destructive dark:bg-destructive/15"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* ── Name field ── */}
      <Field
        id="name"
        label="Full name"
        error={errors.name?.message}
        icon={<User className="h-4 w-4" />}
      >
        <input
          id="name"
          autoComplete="name"
          autoFocus
          placeholder="Enter your full name"
          disabled={isSubmitting || isSuccess}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'name-error' : undefined}
          className={cn(inputBase, errors.name && 'border-destructive focus-visible:ring-destructive')}
          {...register('name')}
        />
      </Field>

      {/* ── Email field ── */}
      <Field
        id="email"
        label="Email address"
        error={errors.email?.message}
        icon={<Mail className="h-4 w-4" />}
      >
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email address"
          disabled={isSubmitting || isSuccess}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          className={cn(inputBase, errors.email && 'border-destructive focus-visible:ring-destructive')}
          {...register('email')}
        />
      </Field>

      {/* ── Password field & requirements ── */}
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
            autoComplete="new-password"
            placeholder="Enter your password"
            disabled={isSubmitting || isSuccess}
            aria-invalid={Boolean(passwordValue.length > 0 && !passwordAnalysis.isValid)}
            aria-describedby="password-requirements-desc"
            className={cn(
              inputWithToggle,
              passwordValue.length > 0 &&
                !passwordAnalysis.isValid &&
                'border-input focus-visible:ring-ring',
              passwordAnalysis.isValid && 'border-emerald-500/60 focus-visible:ring-emerald-500',
            )}
            name={passwordRegister.name}
            ref={passwordRegister.ref}
            onBlur={passwordRegister.onBlur}
            value={passwordValue}
            onInput={(e) => {
              const val = (e.target as HTMLInputElement).value;
              setPasswordValue(val);
              setValue('password', val, { shouldValidate: true });
            }}
            onChange={(e) => {
              const val = e.target.value;
              setPasswordValue(val);
              setValue('password', val, { shouldValidate: true });
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            disabled={isSubmitting || isSuccess}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {/* ── Password requirements checklist ── */}
        <div
          id="password-requirements-desc"
          aria-live="polite"
          className="mt-2 space-y-2 rounded-lg border bg-muted/20 p-3"
        >
          <p className="text-xs font-semibold text-muted-foreground">Password requirements:</p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-xs select-none">
            {passwordRequirements.map((req) => (
              <li
                key={req.id}
                className={cn(
                  'flex items-center gap-1.5 transition-all duration-200',
                  req.isMet
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-muted-foreground',
                )}
              >
                {req.isMet ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 transition-transform duration-200 scale-105" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                )}
                <span>{req.label}</span>
              </li>
            ))}
          </ul>

          {/* ── All Requirements Satisfied Success Message ── */}
          {passwordAnalysis.isValid && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-emerald-600 dark:text-emerald-400 font-semibold border-t border-emerald-500/20 animate-in fade-in slide-in-from-top-1 duration-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>✓ Password meets all requirements</span>
            </div>
          )}

          {/* ── Password strength meter ── */}
          {passwordValue.length > 0 && (
            <div className="pt-2 border-t border-border/60">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground font-medium">Password strength</span>
                <span
                  className={cn(
                    'font-semibold',
                    passwordAnalysis.metCount <= 2 && 'text-destructive',
                    passwordAnalysis.metCount > 2 && passwordAnalysis.metCount <= 4 && 'text-amber-500',
                    passwordAnalysis.metCount === 5 && strengthInfo.label === 'Strong' && 'text-blue-600 dark:text-blue-400',
                    passwordAnalysis.metCount === 5 && strengthInfo.label === 'Very Strong' && 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {strengthInfo.label}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full transition-all duration-300 rounded-full', strengthInfo.color)}
                  style={{ width: strengthInfo.width }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Confirm password field ── */}
      <Field id="confirmPassword" label="Confirm password" icon={<Lock className="h-4 w-4" />}>
        <input
          id="confirmPassword"
          type={showConfirmPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          disabled={isSubmitting || isSuccess}
          aria-invalid={Boolean(confirmPasswordValue.length > 0 && !passwordsMatch)}
          aria-describedby="confirm-password-status"
          className={cn(
            inputWithToggle,
            confirmPasswordValue.length > 0 &&
              !passwordsMatch &&
              'border-destructive focus-visible:ring-destructive',
            confirmPasswordValue.length > 0 &&
              passwordsMatch &&
              'border-emerald-500 focus-visible:ring-emerald-500',
          )}
          name={confirmPasswordRegister.name}
          ref={confirmPasswordRegister.ref}
          onBlur={confirmPasswordRegister.onBlur}
          value={confirmPasswordValue}
          onInput={(e) => {
            const val = (e.target as HTMLInputElement).value;
            setConfirmPasswordValue(val);
            setValue('confirmPassword', val, { shouldValidate: true });
          }}
          onChange={(e) => {
            const val = e.target.value;
            setConfirmPasswordValue(val);
            setValue('confirmPassword', val, { shouldValidate: true });
          }}
        />
        <button
          type="button"
          onClick={() => setShowConfirmPassword((prev) => !prev)}
          disabled={isSubmitting || isSuccess}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
        >
          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </Field>

      {/* ── Confirm password real-time status ── */}
      <div id="confirm-password-status" role="status">
        {confirmPasswordValue.length === 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
            <span>Passwords match</span>
          </div>
        ) : passwordsMatch ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>✓ Passwords match</span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              <span>Passwords match</span>
            </div>
            <p className="text-xs text-destructive font-medium pl-5">
              Passwords do not match
            </p>
          </div>
        )}
      </div>

      {/* ── Submit button ── */}
      <Button
        type="submit"
        className="h-12 w-full rounded-lg text-sm font-medium transition-all"
        disabled={!isFormValid || isSubmitting || isSuccess}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating account…
          </>
        ) : isSuccess ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Account Created!
          </>
        ) : (
          'Create Owner Account'
        )}
      </Button>
    </form>
  );
}

/* ── Reusable field wrapper ── */
function Field({
  id,
  label,
  error,
  icon,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        {children}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
