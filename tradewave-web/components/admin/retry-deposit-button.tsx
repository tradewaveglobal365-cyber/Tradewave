'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';

/**
 * Releases a held deposit.
 *
 * Only rendered on a PENDING row, which means money arrived while no rate was
 * published. The automatic sweep normally completes these, but it only sees the
 * provider's most recent transactions — once a held deposit scrolls out of that
 * window, this button is the only thing standing between it and a developer.
 *
 * Safe to press twice: the credit goes through the same path as the webhook,
 * where a unique constraint on the ledger entry makes a second credit impossible.
 */
export function RetryDepositButton({ depositId }: { depositId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/admin/deposits/${depositId}/retry`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button
        type="button"
        onClick={retry}
        disabled={busy}
        className="h-8 gap-1.5 px-2.5 text-[0.75rem]"
      >
        <RotateCw className={busy ? 'size-3 animate-spin' : 'size-3'} />
        {busy ? 'Releasing…' : 'Release'}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-[0.6875rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
