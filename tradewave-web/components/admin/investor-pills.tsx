/**
 * Status chips shared by the investor list and the investor detail page.
 *
 * Defined once so a status cannot read one way on the list and another way on
 * the page it links to — the mistake that makes a staff screen untrustworthy.
 */

/** Identity verification, which is the status that decides what a user can do. */
export function KycPill({ status }: { status: string }) {
  const tone =
    status === 'VERIFIED'
      ? 'bg-gain/10 text-gain'
      : status === 'PENDING'
        ? 'bg-pending/15 text-pending'
        : status === 'REJECTED' || status === 'EXPIRED'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground';

  const label =
    status === 'NOT_STARTED'
      ? 'Not started'
      : status.charAt(0) + status.slice(1).toLowerCase();

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

/** Account standing. A dot rather than a chip: it is secondary to the name. */
export function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE'
      ? 'bg-gain'
      : status === 'SUSPENDED'
        ? 'bg-destructive'
        : 'bg-pending';

  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${tone}`}
      title={status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}
      aria-hidden="true"
    />
  );
}
