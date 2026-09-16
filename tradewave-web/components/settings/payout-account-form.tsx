'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, BadgeCheck, Landmark, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setPayoutAccountSchema, type SetPayoutAccountValues } from '@/lib/schemas';
import { ApiError, apiFetch, errorMessage } from '@/lib/api';
import type { Bank, PayoutAccount } from '@/lib/wallet';
import type { PublicUser } from '@/lib/types';

/**
 * The bank account money will eventually be paid out to.
 *
 * The account name must name the person who verified their identity — the API
 * decides that and this form only relays the refusal. The account-name field is
 * pre-filled with the verified name because in the overwhelmingly common case
 * the account IS in their own name, and making them retype it invites a typo
 * into the one field that gets checked.
 */
export function PayoutAccountForm({
  user,
  account,
  banks,
}: {
  user: PublicUser;
  account: PayoutAccount | null;
  /** Null when the list could not be loaded — not the same as "no banks". */
  banks: Bank[] | null;
}) {
  const router = useRouter();
  const verified = user.kycStatus === 'VERIFIED';
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SetPayoutAccountValues>({
    resolver: zodResolver(setPayoutAccountSchema),
    defaultValues: {
      bankCode: account?.bankCode ?? '',
      accountNumber: '',
      accountName: account?.accountName ?? `${user.firstName} ${user.lastName}`,
    },
  });

  // Identity first. Showing a form that the API is certain to refuse would be a
  // worse experience than explaining why it is not here yet.
  if (!verified) {
    return (
      <Notice
        icon={<ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        title="Verify your identity first"
        body="Money can only be paid to an account in your own name, so we need to know your name before you can add one."
      >
        <Button asChild className="mt-3 h-10">
          <Link href="/verify-identity">Verify identity</Link>
        </Button>
      </Notice>
    );
  }

  if (account && !editing) {
    return (
      <div>
        {justSaved ? (
          <p className="mb-3 flex items-center gap-1.5 text-[0.8125rem] font-medium text-gain">
            <BadgeCheck className="size-4" />
            Payout account saved
          </p>
        ) : null}
        <AccountCard account={account} />
        <Button
          type="button"
          variant="ghost"
          className="mt-3 h-10"
          onClick={() => {
            setJustSaved(false);
            setEditing(true);
          }}
        >
          Replace account
        </Button>
      </div>
    );
  }

  // A form whose bank dropdown is empty cannot be completed, so do not show one.
  // This is the state a user was previously left in with no explanation: a
  // select containing only "Choose a bank" and no way to tell whether it was
  // still loading, broken, or waiting on them.
  if (!banks) {
    return (
      <div>
        <Notice
          icon={<AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          title="We can’t load the list of banks"
          body="This is on our side, not yours — your account details are fine. Try again in a moment."
        >
          <Button
            type="button"
            variant="ghost"
            className="mt-3 h-10"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="size-3.5" />
            Try again
          </Button>
        </Notice>
        {account ? (
          <div className="mt-4">
            <p className="mb-2 text-[0.8125rem] text-muted-foreground">
              Your current account is unaffected:
            </p>
            <AccountCard account={account} />
          </div>
        ) : null}
      </div>
    );
  }

  async function onSubmit(values: SetPayoutAccountValues) {
    setFormError(null);
    try {
      await apiFetch('/wallet/payout-account', { method: 'PUT', body: values });
      setEditing(false);
      setJustSaved(true);
      router.refresh();
    } catch (err) {
      // The name refusal comes back on accountName and is the message that
      // actually matters — it names the verified identity.
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          if (field === 'bankCode' || field === 'accountNumber' || field === 'accountName') {
            setError(field, { message });
          }
        }
        return;
      }
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field label="Bank" error={errors.bankCode?.message}>
        <select
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-[0.875rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 md:h-10"
          {...register('bankCode')}
        >
          <option value="">Choose a bank</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="mt-4">
        <Field label="Account number" error={errors.accountNumber?.message} hint="10 digits.">
          <Input
            inputMode="numeric"
            maxLength={10}
            placeholder="0690000032"
            className="h-11 tabular-nums md:h-10"
            {...register('accountNumber')}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field
          label="Account name"
          error={errors.accountName?.message}
          hint="It must be your own account — this is checked against your verified identity."
        >
          <Input className="h-11 md:h-10" {...register('accountName')} />
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

      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting} className="h-11 md:h-10">
          {isSubmitting ? 'Saving…' : account ? 'Replace account' : 'Save account'}
        </Button>
        {account ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 md:h-10"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** The saved account, shown wherever the current state needs stating. */
function AccountCard({ account }: { account: PayoutAccount }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-hairline bg-canvas px-4 py-3.5">
      <Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-medium text-foreground">{account.bankName}</p>
        <p className="mt-0.5 font-mono text-[0.8125rem] tracking-[0.04em] text-muted-foreground tabular-nums">
          {account.accountNumberMasked}
        </p>
        <p className="mt-1 truncate text-[0.75rem] text-muted-foreground">
          {account.accountName}
        </p>
        {account.nameResolved ? (
          <p className="mt-1.5 flex items-center gap-1 text-[0.6875rem] text-gain">
            <BadgeCheck className="size-3" />
            Confirmed with the bank
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Notice({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-hairline bg-canvas px-4 py-4">
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="text-[0.8125rem] font-medium text-foreground">{title}</p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">{body}</p>
          {children}
        </div>
      </div>
    </div>
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
