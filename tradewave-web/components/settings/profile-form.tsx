'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Check, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateProfileSchema, type UpdateProfileValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { PublicUser } from '@/lib/types';

/**
 * Editing your own profile.
 *
 * The name exists here for one reason above all: a document that does not match
 * the account name is the commonest cause of a failed identity check, and it is
 * the user's to fix. Before this, the verification page told them to contact
 * support for something they could correct in ten seconds.
 *
 * The name locks once a check stands behind it. Mirrors canEditName in
 * tradewave-api/src/modules/auth/auth.service.ts — the API is the authority and
 * rejects a locked change regardless of what this form allows.
 */
export function ProfileForm({ user }: { user: PublicUser }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const nameEditable =
    user.kycStatus === 'NOT_STARTED' ||
    user.kycStatus === 'REJECTED' ||
    user.kycStatus === 'EXPIRED';

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? '',
    },
  });

  async function onSubmit(values: UpdateProfileValues) {
    setFormError(null);
    setSaved(false);

    // Names are omitted entirely when locked rather than sent unchanged. The API
    // treats an identical value as no change, but not sending them at all means
    // a verified user editing their phone cannot trip the lock on a technicality.
    const payload: Record<string, string> = { phone: values.phone ?? '' };
    if (nameEditable) {
      payload.firstName = values.firstName;
      payload.lastName = values.lastName;
    }

    try {
      await apiFetch('/auth/me', { method: 'PATCH', body: payload });
      setSaved(true);
      reset(values);
      // The name is rendered by server components across the dashboard.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          if (field === 'firstName' || field === 'lastName' || field === 'phone') {
            setError(field, { message });
          }
        }
        setFormError(err.message);
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message}>
          <Input disabled={!nameEditable} {...register('firstName')} />
        </Field>
        <Field label="Last name" error={errors.lastName?.message}>
          <Input disabled={!nameEditable} {...register('lastName')} />
        </Field>
      </div>

      {!nameEditable ? (
        <div className="mt-2.5 flex items-start gap-2.5 rounded-lg border border-hairline bg-canvas px-3.5 py-3">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
            {user.kycStatus === 'PENDING'
              ? 'Your name is locked while your identity check is in progress.'
              : 'Your identity is verified against this name, so it can no longer be changed here. Contact support if it is wrong.'}
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <Field
          label="Phone"
          error={errors.phone?.message}
          hint="Optional. Leave blank to remove it."
        >
          <Input type="tel" placeholder="+234 801 234 5678" {...register('phone')} />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ReadOnly label="Email" value={user.email} note="Contact support to change this." />
        <ReadOnly label="Country" value={user.country} />
      </div>

      {formError ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.75rem] text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting || !isDirty} className="h-10">
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
        {saved ? (
          <span className="flex items-center gap-1.5 text-[0.8125rem] text-gain">
            <Check className="size-3.5" />
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[0.8125rem] font-medium text-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p role="alert" className="mt-1 text-[0.75rem] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[0.75rem] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function ReadOnly({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-[0.8125rem] font-medium text-foreground">{label}</p>
      <p className="mt-1.5 truncate text-[0.875rem] text-muted-foreground">{value}</p>
      {note ? <p className="mt-1 text-[0.75rem] text-muted-foreground">{note}</p> : null}
    </div>
  );
}
