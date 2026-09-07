'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';

/**
 * Revokes every session for the account.
 *
 * Wires POST /auth/logout-all, built in Phase 1 and unused until now. This is
 * the control a user reaches for after a suspected compromise, so it must not
 * silently fail — a failure is surfaced rather than swallowed.
 */
export function SignOutAllButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutAll() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ message: string }>('/auth/logout-all', { method: 'POST' });
      window.location.href = '/login';
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="outline" onClick={signOutAll} disabled={busy} className="h-11 gap-1.5 md:h-10">
        <LogOut className="size-3.5" />
        {busy ? 'Signing out…' : 'Sign out of all devices'}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-[0.75rem] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
