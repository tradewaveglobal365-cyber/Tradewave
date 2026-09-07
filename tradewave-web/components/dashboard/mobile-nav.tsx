'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal, X } from 'lucide-react';
import { PRIMARY_ITEMS, SECONDARY_ITEMS, isActive } from '@/lib/nav';
import { formatAed } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Mobile bottom tab bar.
 *
 * Four primary destinations plus "More", because five is the practical ceiling
 * before targets get too narrow to hit. Everything else lives in the sheet.
 */
export function MobileNav({ balanceFils }: { balanceFils: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const moreActive = SECONDARY_ITEMS.some((i) => isActive(pathname, i.href));

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-hairline bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[0.9375rem] font-semibold text-foreground">More</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mb-3 rounded-xl bg-brand-900 p-4">
              <p className="text-[0.6875rem] font-medium tracking-wide text-brand-300 uppercase">
                Wallet balance
              </p>
              <p className="mt-1 text-[1.25rem] leading-none font-semibold tabular-nums text-white">
                {formatAed(balanceFils)}
              </p>
            </div>

            <nav className="space-y-1" aria-label="More sections">
              {SECONDARY_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(pathname, href) ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-3 text-[0.875rem] font-medium transition-colors',
                    isActive(pathname, href)
                      ? 'bg-brand-100 text-brand-900'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Dashboard"
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-hairline bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {PRIMARY_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.625rem] font-medium transition-colors',
                active ? 'text-brand-700' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className={cn(
            'flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.625rem] font-medium transition-colors',
            moreActive ? 'text-brand-700' : 'text-muted-foreground',
          )}
        >
          <MoreHorizontal className="size-5" />
          More
        </button>
      </nav>
    </>
  );
}
