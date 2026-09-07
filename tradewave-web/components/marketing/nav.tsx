'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TradewaveLogo } from '@/components/brand/logo';
import { NAV_LINKS } from '@/content/home';
import { cn } from '@/lib/utils';

/**
 * Marketing navbar.
 *
 * The hero is on the light canvas, so the bar's text is always dark; only the
 * background changes — transparent at rest, then the same
 * `bg-surface/85 backdrop-blur` treatment as the dashboard header once scrolled,
 * so the two chromes are recognisably the same bar.
 *
 * Every link here is either an in-page anchor or /signup /login. It deliberately
 * does NOT link to /properties: proxy.ts lists that under PROTECTED_PREFIXES,
 * so a logged-out visitor clicking it lands on the login screen instead of the
 * thing they asked for.
 */
export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll(); // a reload partway down the page must not start transparent
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Scroll lock, Escape, and a Tab cycle confined to the panel.
  useEffect(() => {
    if (!open) return;

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusables?.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // A background whenever the bar is scrolled OR the mobile panel is open — an
  // open panel needs the bar to read as part of the same opaque surface.
  const solid = scrolled || open;

  return (
    <>
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
          solid
            ? 'border-b border-hairline bg-surface/85 backdrop-blur'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6">
          <Link href="/" aria-label="Tradewave — home" className="text-brand-900">
            <TradewaveLogo />
          </Link>

          <nav className="ml-auto hidden items-center gap-7 lg:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[0.875rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </div>

          <button
            ref={triggerRef}
            type="button"
            onClick={() => (open ? close() : setOpen(true))}
            aria-expanded={open}
            aria-controls="marketing-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="ml-auto inline-flex size-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </header>

      {/*
        The panel is a SIBLING of <header>, not a child.

        When the bar is solid it carries `backdrop-blur`, and a backdrop-filter
        makes an element a containing block for fixed-position descendants — so
        nested inside the header this panel resolved `top-16 bottom-0` against
        the 64px bar and collapsed to a single row instead of filling the screen.
      */}
      {open ? (
        <div
          id="marketing-menu"
          ref={panelRef}
          className="fixed inset-x-0 top-16 bottom-0 z-40 flex flex-col gap-1 overflow-y-auto border-t border-hairline bg-surface px-6 py-6 lg:hidden"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={close}
              className="rounded-lg px-2 py-3.5 text-[1.0625rem] font-medium text-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {link.label}
            </a>
          ))}

          <div className="mt-4 flex flex-col gap-2.5 border-t border-hairline pt-6">
            <Button asChild variant="outline" className="h-11 w-full text-base">
              <Link href="/login" onClick={close}>
                Sign in
              </Link>
            </Button>
            <Button asChild className="h-11 w-full text-base">
              <Link href="/signup" onClick={close}>
                Get started
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
