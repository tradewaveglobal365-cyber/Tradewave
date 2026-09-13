'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { DepositAccount } from '@/lib/wallet';
import { formatNgn } from '@/lib/money';

/**
 * The transfer instructions.
 *
 * A dedicated account rather than a checkout: the user leaves for their own
 * banking app and comes back, so everything they need has to be copyable and
 * nothing here can depend on them staying on the page. There is no amount
 * field, deliberately — the account accepts whatever they send, and a field
 * that looks binding but is not would be a lie.
 */
export function AddFundsPanel({ account }: { account: DepositAccount }) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <p className="text-[0.8125rem] font-medium text-foreground">
        Transfer naira to this account
      </p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
        It is yours permanently — save it and reuse it for every deposit. Your balance
        updates once the transfer clears, usually within a few minutes.
      </p>

      <dl className="mt-4 space-y-px overflow-hidden rounded-lg border border-hairline">
        <Field label="Bank" value={account.bankName} />
        <Field label="Account number" value={account.accountNumber} mono copyable />
        <Field label="Account name" value={account.accountName} copyable />
      </dl>

      {account.rateMinorPerUnit ? (
        <p className="mt-3 text-[0.75rem] text-muted-foreground">
          Today&rsquo;s rate:{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatNgn(account.rateMinorPerUnit)} = $1.00
          </span>
          {account.exampleKoboForHundredUsd ? (
            <>
              {' '}
              — so {formatNgn(account.exampleKoboForHundredUsd)} funds $100.00.
            </>
          ) : null}
        </p>
      ) : (
        // Fails closed rather than showing a stale or guessed number. A rate is
        // what decides how many dollars a transfer becomes; there is no honest
        // figure to show until an admin publishes one.
        <p className="mt-3 rounded-lg border border-dashed border-hairline px-3 py-2 text-[0.75rem] leading-relaxed text-muted-foreground">
          The naira rate is being updated. Your account number stays the same — anything
          you send is held and credited at the published rate.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  copyable = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access is refused in some browsers and over plain http. The
      // value is on screen and selectable, so there is nothing to recover from.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-surface px-3.5 py-2.5">
      <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-right">
        <span
          className={`text-[0.8125rem] font-medium text-foreground ${
            mono ? 'font-mono tracking-[0.04em] tabular-nums' : ''
          }`}
        >
          {value}
        </span>
        {copyable ? (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-canvas hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-gain" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        ) : null}
      </dd>
    </div>
  );
}
