import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Sign in · Tradewave',
  description: 'Sign in to your Tradewave investment account.',
};

export default function LoginPage() {
  return (
    <div>
      <header className="mb-7">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-foreground">
          Welcome back
        </h1>
        <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
          Sign in to manage your investments.
        </p>
      </header>

      {/* LoginForm reads ?next= via useSearchParams, which opts the subtree
          out of prerendering unless it sits behind a Suspense boundary. */}
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <LoginForm />
      </Suspense>

      <p className="mt-7 text-center text-[0.875rem] text-muted-foreground">
        New to Tradewave?{' '}
        <Link
          href="/signup"
          className="font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
