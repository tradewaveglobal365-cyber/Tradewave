import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Set a new password · Tradewave' };

export default function ResetPasswordPage() {
  return (
    <div>
      <header className="mb-7">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-foreground">
          Set a new password
        </h1>
        <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
          Choose something you haven&rsquo;t used elsewhere.
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-56 w-full rounded-lg" />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
