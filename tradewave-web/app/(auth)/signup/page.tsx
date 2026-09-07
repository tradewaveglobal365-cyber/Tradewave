import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { SignupForm } from '@/components/auth/signup-form';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Create your account · Tradewave',
  description: 'Open a Tradewave account and start investing in vetted real estate.',
};

export default function SignupPage() {
  return (
    <div>
      <header className="mb-7">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-foreground">
          Create your account
        </h1>
        <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
          It takes about a minute.
        </p>
      </header>

      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense fallback={<Skeleton className="h-[28rem] w-full rounded-lg" />}>
        <SignupForm />
      </Suspense>

      <p className="mt-7 text-center text-[0.875rem] text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
