import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/session';
import { getWithdrawalContext } from '@/lib/wallet';
import { WithdrawPanel } from '@/components/wallet/withdraw-panel';

/**
 * Taking money out, on its own screen.
 *
 * A page rather than a modal, for the same reasons the payout account got one:
 * it is reached from a call to action, it is something people want to come back
 * to, and there is no dialog primitive in this codebase — a modal here would
 * mean a money form inside a scrolling box inside a scrolling page on a phone.
 */
export const metadata = { title: 'Withdraw' };

export default async function WithdrawPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/wallet/withdraw');

  const context = await getWithdrawalContext();

  return (
    <div className="max-w-xl">
      <Link
        href="/wallet"
        className="mb-5 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Wallet
      </Link>

      <h1 className="text-[1.625rem] font-semibold tracking-[-0.025em] text-foreground">
        Withdraw
      </h1>
      <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted-foreground">
        Send money from your wallet to your Nigerian bank account.
      </p>

      <div className="mt-6 rounded-xl border border-hairline bg-surface p-5 sm:p-6">
        <WithdrawPanel context={context} />
      </div>

      <p className="mt-4 flex items-start gap-2 text-[0.75rem] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" />
        <span>
          Every withdrawal is checked by a person before the money is sent, and it can only go
          to the account in your own name. You will get an email when it is on its way.
        </span>
      </p>
    </div>
  );
}
