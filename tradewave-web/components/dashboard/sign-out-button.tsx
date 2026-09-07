'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Even if the revoke call fails, send the user to a signed-out state.
    }
    // Hard navigation so the server re-reads (now-cleared) cookies.
    window.location.href = '/login';
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={busy} className="gap-1.5">
      <LogOut className="size-3.5" />
      <span className="hidden sm:inline">{busy ? 'Signing out…' : 'Sign out'}</span>
    </Button>
  );
}
