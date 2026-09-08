'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { KycStatusView } from '@/lib/types';

const INTERVAL_MS = 5000;
/** ~5 minutes. Past that the decision is arriving by email, not by staring. */
const MAX_POLLS = 60;

/**
 * Watches a pending verification and refreshes the page when it resolves.
 *
 * The API reconciles with the provider on each read, so polling here also covers
 * local development, where the provider cannot reach localhost and no webhook is
 * ever delivered.
 */
export function VerificationPoller() {
  const router = useRouter();
  const polls = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const id = setInterval(async () => {
      if (cancelled) return;
      if (++polls.current > MAX_POLLS) {
        clearInterval(id);
        return;
      }
      try {
        const status = await apiFetch<KycStatusView>('/kyc/me');
        if (!cancelled && status.status !== 'PENDING') {
          clearInterval(id);
          // Re-render the server component so the checklist, settings and this
          // page all pick up the new state from one fetch.
          router.refresh();
        }
      } catch {
        // A blip is not worth surfacing — the next tick tries again.
      }
    }, INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return null;
}
