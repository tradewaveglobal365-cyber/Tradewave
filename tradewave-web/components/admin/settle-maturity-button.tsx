'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';

/**
 * Forces one overdue maturity through.
 *
 * Only shown on rows that are already past their date. Settling is idempotent
 * on the server — the status transition is conditional and the ledger
 * references are unique — so a double-click cannot pay twice.
 */
export function SettleMaturityButton({
  investmentId,
  full = false,
}: {
  investmentId: string;
  full?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settle() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/admin/maturities/${investmentId}/settle`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        onClick={settle}
        disabled={busy}
        className={full ? 'h-10 w-full gap-1.5 text-[0.8125rem]' : 'h-8 gap-1.5 px-2.5 text-[0.75rem]'}
      >
        <Check className="size-3.5" />
        {busy ? 'Settling…' : 'Settle now'}
      </Button>
      {error ? (
        <p role="alert" className="mt-1.5 text-[0.6875rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
