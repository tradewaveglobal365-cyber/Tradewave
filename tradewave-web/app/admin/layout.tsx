import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { AdminShell } from '@/components/admin/admin-shell';

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

  return <AdminShell email={user.email}>{children}</AdminShell>;
}
