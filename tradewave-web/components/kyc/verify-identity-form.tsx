'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Camera, ScanLine, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { submitKycSchema, type SubmitKycValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { KycStatusView, PublicUser } from '@/lib/types';

const STEPS = [
  {
    icon: ScanLine,
    title: 'Photograph your ID',
    body: 'National ID card, NIN slip, passport, driver’s licence or voter’s card.',
  },
  {
    icon: Camera,
    title: 'Take a selfie',
    body: 'Checked for liveness and matched against the photo on your document.',
  },
];

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
    formState: { errors, isSubmitting },
  } = useForm<SubmitKycValues>({
    resolver: zodResolver(submitKycSchema),
    defaultValues: { consent: false },
  });

  async function onSubmit(values: SubmitKycValues) {
    setFormError(null);
    try {
      const result = await apiFetch<KycStatusView>('/kyc/submit', {
        method: 'POST',
        body: { consent: values.consent },
      });

      // The provider hosts the capture steps, so finishing means leaving this app.
      // assign() rather than router.push(): this is an external origin.
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }

      // No hosted step (the stub driver decides inline) — re-render the server
      // component so every surface reading kycStatus updates from one fetch.
      router.refresh();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'TOO_MANY_REQUESTS'
          ? err.message
          : errorMessage(err),
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="rounded-lg border border-hairline bg-canvas px-4 py-3 text-sm">
        <p className="text-muted-foreground">Verifying as</p>
        <p className="font-medium text-foreground">
          {user.firstName} {user.lastName}
        </p>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          Your document must be in this name. Contact support if it is wrong.
        </p>
      </div>

      <ol className="space-y-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-700/10 text-brand-700">
              <Icon className="size-3.5" />
            </span>
            <div>
              <p className="text-[0.875rem] font-medium text-foreground">
                {i + 1}. {title}
              </p>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <label className="flex cursor-pointer items-start gap-2.5 text-[0.75rem] leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          {...register('consent')}
          className="mt-0.5 size-4 shrink-0 rounded border-input accent-brand-700"
        />
        <span>
          I consent to my identity document and a selfie being checked to verify
          who I am. Tradewave stores neither — only the result, and a one-way
          fingerprint of the document number.
        </span>
      </label>
      {errors.consent?.message ? (
        <p role="alert" className="-mt-3 text-[0.75rem] text-destructive">
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
        {isSubmitting ? 'Starting…' : 'Verify my identity'}
      </Button>

      <p className="flex items-start gap-2 text-[0.75rem] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" />
        <span>
          You will be taken to our verification partner to capture your document
          and selfie, then returned here. It takes about a minute.
        </span>
      </p>

      {attemptsRemaining <= 3 ? (
        <p className="text-center text-[0.75rem] text-muted-foreground">
          {attemptsRemaining} {attemptsRemaining === 1 ? 'attempt' : 'attempts'} remaining
        </p>
      ) : null}
    </form>
  );
}
