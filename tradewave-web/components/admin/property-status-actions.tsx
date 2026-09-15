'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, Globe, Undo2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';
import type { AdminProperty } from '@/lib/admin';

type Action = 'publish' | 'close' | 'unpublish';

/**
 * Moving a listing between draft, live and closed.
 *
 * FUNDED is absent on purpose — the invest flow sets it when the last
 * allocation is taken, and an admin being able to declare a property funded
 * that is not would make the status mean two different things.
 */
export function PropertyStatusActions({ property }: { property: AdminProperty }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/admin/properties/${property.id}/status`, {
        method: 'POST',
        body: { action },
      });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const isDraft = property.status === 'DRAFT';
  const isLive = property.status === 'OPEN' || property.status === 'FUNDED';

  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[0.9375rem] font-semibold text-foreground">
            {isDraft ? 'Not published' : property.status === 'CLOSED' ? 'Closed' : 'Live'}
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            {isDraft
              ? 'Only you can see this. Preview it, then publish when the copy and photographs are right.'
              : property.status === 'CLOSED'
                ? 'Removed from browse. Existing investors keep their holdings.'
                : 'Visible to investors and open for investment.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* The real page, not a mock. A draft 404s for everyone else, which is
              what makes previewing it safe. */}
          <Button asChild variant="ghost" className="h-9 gap-1.5">
            <Link href={`/properties/${property.slug}`} target="_blank">
              <Eye className="size-3.5" />
              Preview
            </Link>
          </Button>

          {isDraft ? (
            <Button onClick={() => run('publish')} disabled={busy !== null} className="h-9 gap-1.5">
              <Globe className="size-3.5" />
              {busy === 'publish' ? 'Publishing…' : 'Publish'}
            </Button>
          ) : null}

          {isLive && property.fundedCents === '0' ? (
            <Button
              variant="ghost"
              onClick={() => run('unpublish')}
              disabled={busy !== null}
              className="h-9 gap-1.5"
            >
              <Undo2 className="size-3.5" />
              Unpublish
            </Button>
          ) : null}

          {isLive ? (
            <Button
              variant="ghost"
              onClick={() => run('close')}
              disabled={busy !== null}
              className="h-9 gap-1.5"
            >
              <XCircle className="size-3.5" />
              {busy === 'close' ? 'Closing…' : 'Close'}
            </Button>
          ) : null}

          {property.status === 'CLOSED' ? (
            <Button onClick={() => run('publish')} disabled={busy !== null} className="h-9 gap-1.5">
              <Globe className="size-3.5" />
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      {property.images.length === 0 && isDraft ? (
        <p className="mt-3 rounded-lg border border-dashed border-hairline px-3 py-2 text-[0.75rem] text-muted-foreground">
          Add at least one photograph before publishing.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[0.75rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
