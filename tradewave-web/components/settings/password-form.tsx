'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Check, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import { changePasswordSchema, type ChangePasswordValues } from '@/lib/schemas';

/**
 * Changing the password without leaving the app.
 *
 * The current password is asked for even though the user is signed in. A
 * session proves the browser was signed in at some point; it does not prove the
 * person at the keyboard is the account owner, and an unattended laptop is
 * exactly the case that turns into a permanently stolen account.
 *
 * On success, this session stays signed in and every other one is ended — the
 * count comes back from the API so the confirmation can say so rather than
 * leaving the user wondering whether it took effect on their phone.
 */
export function PasswordForm() {
  const [done, setDone] = useState<{ otherSessionsEnded: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', password: '', confirm: '' },
  });

  async function onSubmit(values: ChangePasswordValues) {
    setFormError(null);
    setDone(null);
    try {
      const res = await apiFetch<{ otherSessionsEnded: number }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: values.currentPassword, password: values.password },
      });
      // Cleared rather than left filled: a password sitting in a form field on
      // a shared screen is the thing this whole feature exists to protect.
      reset({ currentPassword: '', password: '', confirm: '' });
      setDone({ otherSessionsEnded: res.otherSessionsEnded ?? 0 });
    } catch (err) {
      // The wrong-current-password refusal and the breached-password refusal
      // both come back as field errors, and both are the message that actually
      // matters — this form's own validation cannot produce either.
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          if (field === 'currentPassword' || field === 'password') {
            setError(field, { message });
          }
        }
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  if (done) {
    return (
      <div>
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 size-4 shrink-0 text-gain" />
          <div>
            <p className="text-[0.875rem] font-medium text-foreground">Password changed</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
              {done.otherSessionsEnded === 0
                ? 'You are still signed in here, and no other devices were signed in.'
                : `You are still signed in here. ${done.otherSessionsEnded} other ${
                    done.otherSessionsEnded === 1 ? 'device was' : 'devices were'
                  } signed out.`}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setDone(null)}
          className="mt-4 h-10"
        >
          Change it again
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="space-y-4">
        <Field label="Current password" error={errors.currentPassword?.message}>
          <Input
            type="password"
            autoComplete="current-password"
            {...register('currentPassword')}
          />
        </Field>

        <Field
          label="New password"
          error={errors.password?.message}
          hint="At least 8 characters. A short phrase is stronger than a mangled word."
        >
          <div className="relative">
            <Input
              type={visible ? 'text' : 'password'}
              autoComplete="new-password"
              className="pr-10"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <Field label="Confirm new password" error={errors.confirm?.message}>
          <Input type={visible ? 'text' : 'password'} autoComplete="new-password" {...register('confirm')} />
        </Field>
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

      <p className="mt-4 text-[0.75rem] leading-relaxed text-muted-foreground">
        Changing your password signs out every other device. You will stay signed in here.
      </p>

      <Button type="submit" disabled={isSubmitting} className="mt-4 h-11 md:h-10">
        {isSubmitting ? 'Changing…' : 'Change password'}
      </Button>
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
        <p role="alert" className="mt-1 text-[0.75rem] leading-relaxed text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[0.75rem] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
