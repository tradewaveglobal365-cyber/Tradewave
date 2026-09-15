import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown while an admin page's server component resolves.
 *
 * Every page here is dynamic and fetches from the API on the server, and on
 * Render's free tier that is roughly a second even for a trivial response.
 * Without this boundary a click did nothing visible for that whole second and
 * the app read as broken rather than busy.
 *
 * It also changes what <Link> can prefetch: for a dynamic route Next prefetches
 * up to the nearest loading boundary, so hovering a tab now warms the shell
 * instead of waiting for the click.
 *
 * One file at /admin covers every tab beneath it. The shape is deliberately
 * generic — a heading, then blocks — because a skeleton that mimics one page
 * precisely would be wrong on the other two, and a layout that visibly changes
 * shape on load is worse than one that does not pretend to know.
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
