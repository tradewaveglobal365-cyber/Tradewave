import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { TradewaveLogo } from '@/components/brand/logo';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { AdminMobileNav } from '@/components/admin/admin-mobile-nav';
import { SignOutButton } from '@/components/dashboard/sign-out-button';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The real gate. The proxy can only see THAT a session cookie exists — it has
  // no access to the API's signing secret, so it cannot read a role out of the
  // token, and it is a redirect optimisation rather than a guard.
  //
  // Note this is not the last line of defence either: every /api/v1/admin route
  // re-checks the role against the database. A user who reached this page
  // without the role would see a shell with nothing in it.
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/admin');
  if (user.role !== 'ADMIN') redirect('/dashboard');

  return (
    <div className="flex min-h-dvh bg-canvas">
      <AdminSidebar email={user.email} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-hairline bg-surface px-4 py-3 lg:hidden">
          <Link href="/admin" className="flex items-center gap-2 text-brand-900">
            <TradewaveLogo />
            <span className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
              Admin
            </span>
          </Link>
          <SignOutButton />
        </header>

        <header className="hidden h-14 items-center justify-end gap-3 border-b border-hairline bg-surface px-6 lg:flex">
          <span className="text-[0.8125rem] text-muted-foreground">{user.email}</span>
          <SignOutButton />
        </header>

        <AdminMobileNav />

        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-7 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
