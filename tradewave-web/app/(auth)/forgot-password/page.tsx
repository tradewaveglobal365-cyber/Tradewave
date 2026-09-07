import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password · Tradewave' };

export default function ForgotPasswordPage() {
  return (
    <div>
      <header className="mb-7">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-foreground">
          Reset your password
        </h1>
        <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
          We&rsquo;ll email you a link to set a new one.
        </p>
      </header>

      <ForgotPasswordForm />

      <p className="mt-7 text-center text-[0.875rem] text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
