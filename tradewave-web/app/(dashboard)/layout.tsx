import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { getWallet } from '@/lib/wallet';
import { TradewaveLogo } from '@/components/brand/logo';
import { Sidebar } from '@/components/dashboard/sidebar';
import { MobileNav } from '@/components/dashboard/mobile-nav';
import { SignOutButton } from '@/components/dashboard/sign-out-button';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // The proxy only checks that a session cookie EXISTS — it cannot verify the
  // signature without the API's secret. This is the real gate.
  const [user, wallet] = await Promise.all([getCurrentUser(), getWallet()]);
  if (!user) redirect('/login?next=/dashboard');

  // GET /wallet does not exist yet; fall back to zero rather than hiding the
  // panel, so the layout is already correct when the endpoint lands.
  const balanceCents = wallet?.balanceCents ?? '0';

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar balanceCents={balanceCents} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — the sidebar is hidden below lg. */}
        <header className="flex items-center justify-between border-b border-hairline bg-surface px-4 py-3 lg:hidden">
          <Link href="/dashboard" className="text-brand-900">
            <TradewaveLogo />
          </Link>
          <SignOutButton />
        </header>

        {/* Desktop top bar — identity and sign-out only; navigation is the sidebar's job. */}
        <header className="hidden h-14 items-center justify-end gap-3 border-b border-hairline bg-surface px-6 lg:flex">
          <span className="text-[0.8125rem] text-muted-foreground">
            {user.firstName} {user.lastName.charAt(0)}.
          </span>
          <SignOutButton />
        </header>

        {/* Bottom padding clears the fixed mobile tab bar. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-7 pb-28 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      <MobileNav balanceCents={balanceCents} />
    </div>
  );
}
