import { History } from 'lucide-react';
import type { AdminActionRecord } from '@/lib/admin';

/**
 * What staff have done to this account.
 *
 * The first thing in this product that can answer "who froze this person, and
 * why" without a database client. Append-only server-side, so nothing here can
 * be tidied up later.
 */
const LABELS: Record<string, string> = {
  SUSPEND: 'Suspended',
  REINSTATE: 'Reinstated',
  RESTRICT: 'Restricted',
  UNRESTRICT: 'Restriction lifted',
  BLOCK_WITHDRAWALS: 'Withdrawals blocked',
  UNBLOCK_WITHDRAWALS: 'Withdrawals unblocked',
  FORCE_KYC_REVERIFICATION: 'Identity re-check required',
  ADJUST_BALANCE: 'Balance adjusted',
  VERIFY_EMAIL: 'Email marked verified',
};

export function AccountActivity({ actions }: { actions: AdminActionRecord[] }) {
  if (actions.length === 0) {
    return (
      <div className="rounded-xl border border-hairline bg-surface p-5">
        <p className="flex items-center gap-1.5 text-[0.875rem] font-medium text-foreground">
          <History className="size-3.5 text-muted-foreground" />
          Staff activity
        </p>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          Nobody has changed anything on this account.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface p-5">
      <p className="flex items-center gap-1.5 text-[0.875rem] font-medium text-foreground">
        <History className="size-3.5 text-muted-foreground" />
        Staff activity
      </p>

      <ul className="mt-3 space-y-3">
        {actions.map((action) => (
          <li key={action.id} className="border-b border-hairline pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[0.8125rem] font-medium text-foreground">
                {LABELS[action.type] ?? action.type}
              </p>
              <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
                {new Date(action.createdAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
              {action.reason}
            </p>
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
              {action.actor
                ? `${action.actor.firstName} ${action.actor.lastName}`
                : 'A deleted staff account'}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
