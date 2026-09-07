'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/auth/field';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/lib/schemas';
import { apiFetch } from '@/lib/api';
import type { MessageResponse } from '@/lib/types';

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    try {
      await apiFetch<MessageResponse>('/auth/forgot-password', {
        method: 'POST',
        body: { email: values.email },
      });
    } catch {
      // Deliberately swallowed. The API answers identically whether or not the
      // account exists; surfacing a network-level difference here would undo
      // that and turn this form into an account-enumeration oracle.
    }
    setSentTo(String(values.email));
  }

  if (sentTo) {
    return (
      <div className="rounded-xl border border-hairline bg-surface p-6 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-100">
          <MailCheck className="size-5 text-brand-700" />
        </div>
        <h2 className="mt-4 text-[1.0625rem] font-semibold text-foreground">Check your email</h2>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{sentTo}</span>,
          we&rsquo;ve sent a reset link. It expires in 1 hour.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
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

      <Button type="submit" disabled={isSubmitting} className="h-11 w-full md:h-10">
        {isSubmitting ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
