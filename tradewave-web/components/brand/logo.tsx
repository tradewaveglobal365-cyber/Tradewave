import { cn } from '@/lib/utils';

/**
 * The mark: three identical chevrons offset by 8 units, on an opacity ramp.
 *
 * It reads three ways on purpose — stacked rooflines (real estate), an
 * ascending series (growth), and the stagger itself (a *wave*). The bottom
 * chevron closes flat to a baseline so the mark sits grounded rather than
 * floating. Everything is `currentColor`, so one component serves both the
 * white-on-forest auth panel and the green-on-white dashboard header.
 *
 * `compact` drops to two solid chevrons. The opacity ramp is what gives the
 * default its depth, but below ~24px the 0.55 layer washes out and the whole
 * mark collapses into a blob — so anything favicon-sized must use `compact`.
 */
export function TradewaveMark({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-7', className)} aria-hidden="true">
      {compact ? (
        <>
          <path d="M16 4 3 14v5l13-10 13 10v-5L16 4Z" fill="currentColor" />
          <path d="M16 18 3 28v2h26v-2L16 18Z" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M16 3 4 11v3l12-8 12 8v-3L16 3Z" fill="currentColor" opacity="0.55" />
          <path d="M16 11 4 19v3l12-8 12 8v-3l-12-8Z" fill="currentColor" opacity="0.8" />
          <path d="M16 19 4 27v2h24v-2l-12-8Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function TradewaveLogo({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <TradewaveMark className={markClassName} />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">Tradewave</span>
    </span>
  );
}
