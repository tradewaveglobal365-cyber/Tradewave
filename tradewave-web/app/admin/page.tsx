import { redirect } from 'next/navigation';

/**
 * No overview page.
 *
 * There is nothing true to put on one yet, and a dashboard of invented tiles is
 * worse than no dashboard. /admin lands on the tab that actually does something.
 */
export default function AdminIndexPage() {
  redirect('/admin/fx-rate');
}
