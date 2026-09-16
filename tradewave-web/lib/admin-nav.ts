import {
  ArrowLeftRight,
  Banknote,
  Building2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One line, shown under the heading on the page itself. */
  description: string;
}

/**
 * Single source of truth for admin navigation.
 *
 * Mirrors lib/nav.ts, and kept separate from it on purpose: the two areas have
 * different audiences, and an investor must never see a staff link appear
 * because someone added an entry to a shared list.
 *
 * ADDING A TAB IS ONE LINE HERE plus a page under app/admin/. Users, properties,
 * KYC review and withdrawals all land this way when they are worth building.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    href: '/admin/investors',
    label: 'Investors',
    icon: Users,
    description: 'Everyone who has signed up, and where each of them has got to.',
  },
  {
    href: '/admin/identity',
    label: 'Identity',
    icon: ShieldCheck,
    description: 'Verifications the provider escalated and is waiting on us to decide.',
  },
  {
    href: '/admin/properties',
    label: 'Properties',
    icon: Building2,
    description: 'The listings investors can see, and the ones not published yet.',
  },
  {
    href: '/admin/fx-rate',
    label: 'FX rate',
    icon: ArrowLeftRight,
    description: 'The dollar-to-naira rate depositors are quoted and credited at.',
  },
  {
    href: '/admin/deposits',
    label: 'Deposits',
    icon: Banknote,
    description: 'Money that has landed, and anything held waiting on a rate.',
  },
];
