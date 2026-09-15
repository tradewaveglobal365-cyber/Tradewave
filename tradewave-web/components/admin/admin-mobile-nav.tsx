'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { isActive } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Admin navigation below lg.
 *
 * A scrolling tab strip under the header rather than the investor side's fixed
 * bottom bar. Staff work sessions are short and deliberate — you come here to
 * set a rate or unstick a deposit — so navigation does not need to be under a
 * thumb the whole time, and a bottom bar would just eat screen on a table.
 */
export function AdminMobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin"
      className="flex gap-1 overflow-x-auto border-b border-hairline bg-surface px-4 py-2 lg:hidden"
    >
      {ADMIN_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
              active
                ? 'bg-brand-900 text-white'
                : 'text-muted-foreground hover:bg-canvas hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
