import {
  Building2,
  FileText,
  LayoutDashboard,
  PieChart,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. Max five, including "More". */
  primary?: boolean;
}

/**
 * Single source of truth for dashboard navigation.
 *
 * The desktop sidebar and the mobile bottom bar both read this, so a section
 * cannot exist in one and be missing from the other.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, primary: true },
  { href: '/properties', label: 'Properties', icon: Building2, primary: true },
  { href: '/portfolio', label: 'Portfolio', icon: PieChart, primary: true },
  { href: '/wallet', label: 'Wallet', icon: Wallet, primary: true },
  { href: '/referrals', label: 'Referrals', icon: Users },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export const PRIMARY_ITEMS = NAV_ITEMS.filter((i) => i.primary);
export const SECONDARY_ITEMS = NAV_ITEMS.filter((i) => !i.primary);

/** Matches the item itself and anything nested under it (/properties/[slug]). */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
