'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/auth/field';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { ReferralChip } from '@/components/auth/referral-chip';
import { signupSchema, referralCodePattern, type SignupValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { MessageResponse, ReferralValidation } from '@/lib/types';

const REF_COOKIE = 'tw_ref';

function readRefCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)tw_ref=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]).toUpperCase() : null;
}

function clearRefCookie(): void {
  document.cookie = `${REF_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function SignupForm() {
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [referrer, setReferrer] = useState<{ code: string; firstName: string } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', phone: '', referralCode: '' },
  });

  const password = watch('password') ?? '';

  // Resolve the referral code to a human name. The code arrives either in the
  // URL or in the cookie that middleware planted on an earlier visit, so a user
  // who browsed around before signing up keeps their referrer.
  useEffect(() => {
    const raw = (searchParams.get('ref') ?? readRefCookie() ?? '').trim().toUpperCase();
    if (!referralCodePattern.test(raw)) return;

    setValue('referralCode', raw);

    let cancelled = false;
    void apiFetch<ReferralValidation>(`/referrals/validate/${raw}`)
      .then((result) => {
        if (cancelled) return;
        if (result.valid) setReferrer({ code: raw, firstName: result.referrerFirstName });
        // An unrecognised code is left in the field but not advertised — the
        // API ignores it rather than failing the signup.
      })
      .catch(() => {
        /* Never block signup on referral lookup. */
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams, setValue]);

  async function onSubmit(values: SignupValues) {
    setFormError(null);

    const payload = {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      password: values.password,
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.referralCode ? { referralCode: values.referralCode } : {}),
    };

    try {
      await apiFetch<MessageResponse>('/auth/register', { method: 'POST', body: payload });
      clearRefCookie();
      setSubmitted(String(values.email));
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [name, message] of Object.entries(err.fields)) {
          setError(name as keyof SignupValues, { message });
        }
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-hairline bg-surface p-6 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-100">
          <svg viewBox="0 0 24 24" fill="none" className="size-5 text-brand-700" aria-hidden="true">
            <path
              d="m3 7 9 6 9-6M3 7v10h18V7M3 7h18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-[1.0625rem] font-semibold text-foreground">Check your email</h2>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">
          We sent a verification link to{' '}
          <span className="font-medium text-foreground">{submitted}</span>. Click it to activate
          your account. The link expires in 24 hours.
        </p>
        <p className="mt-4 text-[0.8125rem] text-muted-foreground">
          Didn&rsquo;t get it?{' '}
          <Link
            href={`/verify-email?resend=${encodeURIComponent(submitted)}`}
            className="font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            Resend
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {referrer ? (
        <ReferralChip
          referrerFirstName={referrer.firstName}
          code={referrer.code}
          onClear={() => {
            setReferrer(null);
            setValue('referralCode', '');
            clearRefCookie();
          }}
        />
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-[0.8125rem] leading-snug text-destructive"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" error={errors.firstName?.message}>
          {(props) => (
            <Input {...props} {...register('firstName')} autoComplete="given-name" autoFocus />
          )}
        </Field>
        <Field label="Last name" error={errors.lastName?.message}>
          {(props) => <Input {...props} {...register('lastName')} autoComplete="family-name" />}
        </Field>
      </div>

      <Field label="Email" error={errors.email?.message}>
        {(props) => (
          <Input
            {...props}
            {...register('email')}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        )}
      </Field>

      <Field label="Phone" error={errors.phone?.message} hint="Optional">
        {(props) => (
          <Input
            {...props}
            {...register('phone')}
            type="tel"
            autoComplete="tel"
            placeholder="+971 50 000 0000"
          />
        )}
      </Field>

      <Field label="Password" error={errors.password?.message}>
        {(props) => (
          <>
            <PasswordInput
              {...props}
              {...register('password')}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
            <PasswordStrength value={password} />
          </>
        )}
      </Field>

      <input type="hidden" {...register('referralCode')} />

      <Button type="submit" disabled={isSubmitting} className="mt-1 h-11 w-full md:h-10">
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </Button>

      <p className="text-center text-[0.75rem] leading-relaxed text-muted-foreground">
        By creating an account you agree to our{' '}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
