import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/session';
import { PayoutAccountForm } from '@/components/settings/payout-account-form';
import { getBanks, getPayoutAccount } from '@/lib/wallet';

export const metadata: Metadata = { title: 'Payout account \u00b7 Tradewave' };

/**
 * Adding a payout account, on its own screen.
 *
 * It used to be the third card down on Settings, which meant the checklist's
 * "Add" button dropped you at the top of an unrelated page and left you to
 * scroll past your profile and your KYC status to find the thing you clicked.
 * A task you arrive at from a call to action deserves to be the only thing on
 * the screen when you get there.
 *
 * A page rather than a modal: it is reached by a link from two places, it is
 * the kind of thing a user wants to be able to come back to, and a modal on a
 * phone would put a four-field form inside a scrolling box inside a scrolling
 * page.
 */
export default async function PayoutAccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/settings/payout-account');

  // Each is its own round trip; neither depends on the other.
  const [account, banks] = await Promise.all([getPayoutAccount(), getBanks()]);

  return (
    <div className="max-w-xl">
      <Link
        href="/settings"
        className="mb-5 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Settings
      </Link>

      <h1 className="text-[1.625rem] font-semibold tracking-[-0.025em] text-foreground">
        Payout account
      </h1>
      <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted-foreground">
        The Nigerian bank account your returns and withdrawals will be sent to.
      </p>

      <div className="mt-6 rounded-xl border border-hairline bg-surface p-5 sm:p-6">
        <PayoutAccountForm user={user} account={account} banks={banks} />
      </div>

      <p className="mt-4 flex items-start gap-2 text-[0.75rem] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" />
        <span>
          The account must be in your own name. We check it against the identity you
          verified, and against the name your bank holds for the account.
        </span>
      </p>
    </div>
  );
}
