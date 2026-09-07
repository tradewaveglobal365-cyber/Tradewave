'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/auth/field';
import { PasswordInput } from '@/components/auth/password-input';
import { loginSchema, type LoginValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { SessionResponse } from '@/lib/types';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    setNeedsVerification(null);

    try {
      await apiFetch<SessionResponse>('/auth/login', { method: 'POST', body: values });
      // Full navigation, not router.push: the session lives in an httpOnly
      // cookie that server components must re-read on the next request.
      const next = searchParams.get('next');
      window.location.href = next?.startsWith('/') ? next : '/dashboard';
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          setNeedsVerification(String(values.email));
          return;
        }
        if (err.fields) {
          for (const [name, message] of Object.entries(err.fields)) {
            setError(name as keyof LoginValues, { message });
          }
          return;
        }
      }
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-[0.8125rem] leading-snug text-destructive"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      {needsVerification ? (
        <div
          role="alert"
          className="rounded-lg border border-pending/25 bg-pending/5 px-3.5 py-3 text-[0.8125rem] leading-snug text-pending"
        >
          Verify your email before signing in.{' '}
          <Link
            href={`/verify-email?resend=${encodeURIComponent(needsVerification)}`}
            className="font-medium underline underline-offset-4"
          >
            Resend the link
          </Link>
        </div>
      ) : null}

      <Field label="Email" error={errors.email?.message}>
        {(props) => (
          <Input
            {...props}
            {...register('email')}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            autoFocus
          />
        )}
      </Field>

      <Field label="Password" error={errors.password?.message}>
        {(props) => (
          <PasswordInput
            {...props}
            {...register('password')}
            autoComplete="current-password"
            placeholder="Your password"
          />
        )}
      </Field>

      <div className="flex justify-end pt-0.5">
        <Link
          href="/forgot-password"
          className="text-[0.8125rem] font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" disabled={isSubmitting} className="mt-1 h-11 w-full md:h-10">
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
