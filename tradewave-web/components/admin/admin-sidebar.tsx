'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TradewaveLogo } from '@/components/brand/logo';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { isActive } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Admin sidebar.
 *
 * Same dark forest ground as the investor sidebar, so it reads as one product
 * rather than a bolted-on back office. What differs is what sits at the bottom:
 * the investor side puts the wallet balance there because knowing what you can
 * spend while browsing is the point. Staff have no balance, so the space carries
 * the signed-in identity instead.
 */
export function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-brand-800 lg:bg-brand-900">
      <div className="px-5 py-5">
        <Link href="/admin" className="inline-flex flex-col gap-2 text-white">
          <TradewaveLogo />
          <span className="text-[0.6875rem] font-medium tracking-wide text-gold-500 uppercase">
            Admin
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Admin">
        {ADMIN_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-[0.875rem] font-medium transition-colors',
                active
                  ? 'bg-brand-700 text-white'
                  : 'text-brand-200 hover:bg-brand-800 hover:text-white',
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 p-3">
        <div className="rounded-xl bg-brand-800 p-4">
          <p className="text-[0.6875rem] font-medium tracking-wide text-brand-300 uppercase">
            Signed in as
          </p>
          <p className="mt-1 truncate text-[0.8125rem] font-medium text-white" title={email}>
            {email}
          </p>
        </div>
      </div>
    </aside>
  );
}
