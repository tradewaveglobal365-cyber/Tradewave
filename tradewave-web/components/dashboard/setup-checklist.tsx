import Link from 'next/link';
import { BadgeCheck, Banknote, Check, MailCheck, Wallet } from 'lucide-react';
import type { PublicUser } from '@/lib/types';

interface Step {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  done: boolean;
  href?: string;
  cta?: string;
  /** Blocked on something not built yet — shown, but not actionable. */
  pending?: boolean;
}

/**
 * Account setup checklist.
 *
 * Lives on Overview rather than a one-time welcome page, because these steps
 * span multiple sessions — identity verification is not instant, and a screen
 * you see once cannot carry state the user comes back to.
 *
 * Completed steps stay visible but go quiet, so progress feels earned. The
 * entire card disappears once every step is done, rather than becoming a row of
 * ticks nobody needs again.
 */
export function SetupChecklist({
  user,
  hasBalance,
  hasPayoutAccount = false,
  kycVerified = false,
}: {
  user: PublicUser;
  hasBalance: boolean;
  hasPayoutAccount?: boolean;
  kycVerified?: boolean;
}) {
  const steps: Step[] = [
    {
      id: 'email',
      label: 'Verify your email',
      description: 'Confirms we can reach you about your investments.',
      icon: MailCheck,
      done: user.emailVerified,
      href: '/verify-email',
      cta: 'Verify',
    },
    {
      id: 'kyc',
      label: 'Verify your identity',
      description: 'Required before you can invest.',
      icon: BadgeCheck,
      done: kycVerified,
      pending: true,
    },
    {
      id: 'payout',
      label: 'Add a payout account',
      description: 'Where your returns and withdrawals are sent.',
      icon: Banknote,
      done: hasPayoutAccount,
      pending: true,
    },
    {
      id: 'fund',
      label: 'Fund your wallet',
      description: 'Add money so you can invest in a property.',
      icon: Wallet,
      done: hasBalance,
      href: '/wallet',
      cta: 'Fund',
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  // The whole point: once setup is finished, this stops taking up the screen.
  if (completed === steps.length) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-hairline bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-6 py-4">
        <div>
          <h2 className="text-[1rem] font-semibold text-foreground">Finish setting up</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
            A few steps before you can invest.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[0.75rem] font-medium tabular-nums text-muted-foreground">
            {completed} of {steps.length}
          </span>
          <div
            className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-label={`${completed} of ${steps.length} setup steps complete`}
          >
            <div
              className="h-full rounded-full bg-gain transition-[width] duration-500"
              style={{ width: `${(completed / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <ul className="divide-y divide-hairline">
        {steps.map((step) => {
          const Icon = step.done ? Check : step.icon;
          return (
            <li key={step.id} className="flex items-center gap-4 px-6 py-3.5">
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                  step.done ? 'bg-gain/10 text-gain' : 'bg-brand-100 text-brand-700'
                }`}
              >
                <Icon className="size-4" strokeWidth={step.done ? 3 : 2} />
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-[0.875rem] font-medium ${
                    step.done ? 'text-muted-foreground line-through' : 'text-foreground'
                  }`}
                >
                  {step.label}
                </p>
                {!step.done ? (
                  <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{step.description}</p>
                ) : null}
              </div>

              {step.done ? null : step.pending ? (
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[0.6875rem] font-medium text-muted-foreground">
                  Coming soon
                </span>
              ) : (
                <Link
                  href={step.href ?? '#'}
                  className="shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {step.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
