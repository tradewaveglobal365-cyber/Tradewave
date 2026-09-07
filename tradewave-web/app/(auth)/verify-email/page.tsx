import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailClient } from '@/components/auth/verify-email-client';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Verify your email · Tradewave' };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <VerifyEmailClient />
    </Suspense>
  );
}
