'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { TradewaveLogo } from '@/components/brand/logo';
import { SignOutButton } from '@/components/dashboard/sign-out-button';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav';
import { isActive } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Admin shell: sidebar on desktop, off-canvas drawer on mobile.
 *
 * The nav is defined ONCE and rendered into both, so a tab cannot exist at one
 * breakpoint and be missing at the other. The drawer is the same dark panel as
 * the desktop sidebar rather than a different-looking menu — on a phone it
 * should read as the sidebar arriving, not as a separate screen.
 *
 * The drawer stays mounted so it can slide rather than appear. Mounted-but-
 * hidden is a trap for keyboard and screen-reader users, who would otherwise
 * tab into links they cannot see, so it carries `inert` while closed — which
 * removes it from the accessibility tree and from the tab order in one attribute.
 */
export function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /** Closes and hands focus back to the hamburger that opened it. */
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Navigating closes the drawer. Deliberately does NOT move focus: the user is
  // already going somewhere, and yanking focus back to the menu button fights
  // the browser's own focus handling on a route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    // Without this the page behind scrolls under the drawer, which on iOS also
    // strands the user somewhere else once it closes.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    closeRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* ── Desktop sidebar ───────────────────────────────────────────────── */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-brand-800 lg:bg-brand-900">
        <SidebarContent pathname={pathname} email={email} />
      </aside>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      <div className="lg:hidden">
        <div
          aria-hidden="true"
          onClick={close}
          className={cn(
            'fixed inset-0 z-40 bg-ink/50 transition-opacity duration-200',
            open ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />
        <aside
          inert={!open}
          aria-label="Admin navigation"
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col border-r border-brand-800 bg-brand-900 transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <SidebarContent
            pathname={pathname}
            email={email}
            onNavigate={() => setOpen(false)}
            closeRef={closeRef}
            onClose={close}
          />
        </aside>
      </div>

      {/* ── Content column ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-hairline bg-surface/95 px-3 py-2.5 backdrop-blur lg:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            // 44px target: anything smaller is a miss on a phone.
            className="-m-1 rounded-lg p-3 text-foreground transition-colors hover:bg-canvas"
          >
            <Menu className="size-5" />
          </button>

          <Link href="/admin" className="flex min-w-0 items-center gap-2 text-brand-900">
            <TradewaveLogo />
            <span className="text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">
              Admin
            </span>
          </Link>

          <div className="ml-auto">
            <SignOutButton />
          </div>
        </header>

        <header className="hidden h-14 items-center justify-end gap-3 border-b border-hairline bg-surface px-6 lg:flex">
          <span className="text-[0.8125rem] text-muted-foreground">{email}</span>
          <SignOutButton />
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-5 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The sidebar's contents, shared by both breakpoints.
 *
 * Takes `pathname` rather than calling usePathname itself so the two renderings
 * can never disagree about which tab is current.
 */
function SidebarContent({
  pathname,
  email,
  onNavigate,
  onClose,
  closeRef,
}: {
  pathname: string;
  email: string;
  onNavigate?: () => void;
  onClose?: () => void;
  closeRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <>
      <div className="flex items-start justify-between px-5 py-5">
        <Link
          href="/admin"
          onClick={onNavigate}
          className="inline-flex flex-col gap-2 text-white"
        >
          <TradewaveLogo />
          <span className="text-[0.6875rem] font-medium tracking-wide text-gold-500 uppercase">
            Admin
          </span>
        </Link>

        {onClose ? (
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-m-1 rounded-lg p-3 text-brand-200 transition-colors hover:bg-brand-800 hover:text-white"
          >
            <X className="size-5" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {ADMIN_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                // py-3 on mobile, tighter on desktop: a phone needs the target,
                // a mouse does not.
                'flex items-center gap-3 rounded-lg px-3 py-3 text-[0.875rem] font-medium transition-colors lg:py-2',
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

      <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="rounded-xl bg-brand-800 p-4">
          <p className="text-[0.6875rem] font-medium tracking-wide text-brand-300 uppercase">
            Signed in as
          </p>
          <p className="mt-1 truncate text-[0.8125rem] font-medium text-white" title={email}>
            {email}
          </p>
        </div>
      </div>
    </>
  );
}
