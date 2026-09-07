'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/auth/field';
import { submitKycSchema, type SubmitKycValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { KycStatusView, PublicUser } from '@/lib/types';

export function VerifyIdentityForm({
  user,
  attemptsRemaining,
}: {
  user: PublicUser;
  attemptsRemaining: number;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SubmitKycValues>({
    resolver: zodResolver(submitKycSchema),
    defaultValues: { documentNumber: '', consent: false },
  });

  async function onSubmit(values: SubmitKycValues) {
    setFormError(null);
    try {
      // `consent` is recorded by the browser only; the API takes the document.
      await apiFetch<KycStatusView>('/kyc/submit', {
        method: 'POST',
        body: { documentType: 'NIN', documentNumber: values.documentNumber },
      });
      // Re-render the server component so every surface reading kycStatus —
      // this page, the checklist, settings — updates from one fetch.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [name, message] of Object.entries(err.fields)) {
          setError(name as keyof SubmitKycValues, { message });
        }
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="rounded-lg border border-hairline bg-canvas px-4 py-3 text-sm">
        <p className="text-muted-foreground">Verifying as</p>
        <p className="font-medium text-foreground">
          {user.firstName} {user.lastName}
        </p>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          This must match the name registered against your NIN. Contact support if
          it is wrong.
        </p>
      </div>

      <Field
        label="National Identification Number (NIN)"
        error={errors.documentNumber?.message}
        hint="11 digits, as issued by NIMC."
      >
        {(props) => (
          <Input
            {...props}
            {...register('documentNumber')}
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            placeholder="12345678901"
            autoFocus
          />
        )}
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 text-[0.75rem] leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          {...register('consent')}
          className="mt-0.5 size-4 shrink-0 rounded border-input accent-brand-700"
        />
        <span>
          I consent to Tradewave verifying my identity against the national
          register. My NIN is not stored — only a one-way fingerprint of it and
          the last four digits.
        </span>
      </label>
      {errors.consent?.message ? (
        <p role="alert" className="text-[0.75rem] text-destructive">
          {errors.consent.message}
        </p>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <Button type="submit" disabled={isSubmitting} className="h-11 w-full md:h-10">
        {isSubmitting ? 'Verifying…' : 'Verify my identity'}
      </Button>

      {attemptsRemaining <= 3 ? (
        <p className="text-center text-[0.75rem] text-muted-foreground">
          {attemptsRemaining} {attemptsRemaining === 1 ? 'attempt' : 'attempts'} remaining
        </p>
      ) : null}
    </form>
  );
}
