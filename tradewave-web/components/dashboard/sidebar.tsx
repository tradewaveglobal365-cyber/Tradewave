'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { TradewaveLogo } from '@/components/brand/logo';
import { NAV_ITEMS, isActive } from '@/lib/nav';
import { formatAed } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Desktop sidebar.
 *
 * Dark forest ground, deliberately continuing the auth split-screen panel so
 * signing in feels like stepping through the same door rather than into a
 * different product. Content stays on warm canvas.
 *
 * The balance sits at the bottom and is the whole reason this is a sidebar
 * rather than a top nav: on an investment platform, knowing what you can spend
 * WHILE browsing properties is the point.
 */
export function Sidebar({ balanceFils }: { balanceFils: string }) {
  const pathname = usePathname();

  return (
    // sticky + h-dvh, not min-h: the parent stretches to the page content, so
    // without pinning, the balance card ends up below the fold on any long page
    // — which defeats the whole reason for putting it in the sidebar.
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-brand-800 lg:bg-brand-900">
      <div className="px-5 py-5">
        <Link href="/dashboard" className="inline-flex flex-col gap-2 text-white">
          <TradewaveLogo />
          <span className="block h-0.5 w-8 bg-gold-500" />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Dashboard">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
            Wallet balance
          </p>
          <p className="mt-1 text-[1.25rem] leading-none font-semibold tabular-nums text-white">
            {formatAed(balanceFils)}
          </p>
          <Link
            href="/wallet"
            className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-gold-500 px-3 py-2 text-[0.8125rem] font-semibold text-brand-900 transition-colors hover:bg-gold-400 focus-visible:ring-[3px] focus-visible:ring-gold-400/50 focus-visible:outline-none"
          >
            <Plus className="size-3.5" strokeWidth={2.5} />
            Fund wallet
          </Link>
        </div>
      </div>
    </aside>
  );
}
