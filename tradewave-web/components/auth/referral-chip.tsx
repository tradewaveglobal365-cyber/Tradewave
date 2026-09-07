'use client';

import { Gift, X } from 'lucide-react';

/**
 * Shows WHO invited you rather than hiding the code in a hidden input.
 *
 * Naming the referrer is the point: it converts materially better than a silent
 * field, and it gives the user a chance to notice and clear a code they did not
 * expect to be attached to their account.
 */
export function ReferralChip({
  referrerFirstName,
  code,
  onClear,
}: {
  referrerFirstName: string;
  code: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-brand-200 bg-brand-50 px-3.5 py-2.5">
      <Gift className="size-4 shrink-0 text-brand-600" strokeWidth={2} />
      <p className="flex-1 text-[0.8125rem] leading-snug text-brand-900">
        Invited by <span className="font-semibold">{referrerFirstName}</span>
        <span className="ml-1.5 font-mono text-[0.6875rem] tracking-wide text-brand-600">
          {code}
        </span>
      </p>
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove referral code"
        className="rounded p-0.5 text-brand-600 transition-colors hover:bg-brand-100 hover:text-brand-900 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
