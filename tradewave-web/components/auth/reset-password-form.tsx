'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/auth/field';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { resetPasswordSchema, type ResetPasswordValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { MessageResponse } from '@/lib/types';

export function ResetPasswordForm() {
  const token = useSearchParams().get('token');
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const password = watch('password') ?? '';

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null);
    if (!token) {
      setFormError('This reset link is missing its token. Request a new one.');
      return;
    }

    try {
      await apiFetch<MessageResponse>('/auth/reset-password', {
        method: 'POST',
        body: { token, password: values.password },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.fields?.password) {
        setError('password', { message: err.fields.password });
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  if (!token) {
    return (
      <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5 text-[0.875rem] leading-relaxed text-destructive">
        This reset link is invalid or incomplete.{' '}
        <Link href="/forgot-password" className="font-medium underline underline-offset-4">
          Request a new one
        </Link>
        .
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-xl border border-hairline bg-surface p-6 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-100">
          <CheckCircle2 className="size-5 text-gain" />
        </div>
        <h2 className="mt-4 text-[1.0625rem] font-semibold text-foreground">Password updated</h2>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">
          We signed out every device that was using your old password.
        </p>
        <Button asChild className="mt-5 h-11 w-full md:h-10">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
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

      <Field label="New password" error={errors.password?.message}>
        {(props) => (
          <>
            <PasswordInput
              {...props}
              {...register('password')}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              autoFocus
            />
            <PasswordStrength value={password} />
          </>
        )}
      </Field>

      <Field label="Confirm new password" error={errors.confirmPassword?.message}>
        {(props) => (
          <PasswordInput
            {...props}
            {...register('confirmPassword')}
            autoComplete="new-password"
            placeholder="Re-enter your password"
          />
        )}
      </Field>

      <Button type="submit" disabled={isSubmitting} className="h-11 w-full md:h-10">
        {isSubmitting ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}
