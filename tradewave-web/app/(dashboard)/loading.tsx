import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown while a dashboard page's server component resolves.
 *
 * Same reasoning as app/admin/loading.tsx: every page here fetches from the API
 * on the server, which on Render's free tier costs about a second even for a
 * trivial response, and without a boundary the click produced nothing visible
 * for that whole second.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}
