import Link from 'next/link';
import { ShieldCheck, Building2, Users } from 'lucide-react';
import { TradewaveLogo, TradewaveMark } from '@/components/brand/logo';

/**
 * Split screen at lg and up, form-only below.
 *
 * The left panel carries the trust load — this is where a visitor decides
 * whether to hand over money — so it stays visible on every auth screen rather
 * than being decoration on the login page alone.
 *
 * The figures are placeholders until there are real numbers to wire in. Do not
 * ship invented metrics to production.
 */
const TRUST_SIGNALS = [
  { icon: ShieldCheck, label: 'Title-verified before listing' },
  { icon: Building2, label: 'Freehold Dubai property portfolio' },
  { icon: Users, label: 'Every investor verified before funding' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ── Brand panel ─────────────────────────────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-brand-900 p-10 text-white lg:flex lg:flex-col xl:p-14">
        {/* Depth without an image asset: two soft radial washes over the ground. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'radial-gradient(120% 90% at 12% 0%, #12664B 0%, transparent 55%), radial-gradient(100% 80% at 100% 100%, #0E5139 0%, transparent 60%)',
          }}
        />
        {/* Faint architectural grid — reads as blueprint, not decoration. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        <div className="relative flex h-full flex-col">
          <Link href="/" className="inline-flex w-fit flex-col gap-2.5">
            <TradewaveLogo />
            {/* The one place gold appears on this screen. */}
            <span className="block h-0.5 w-9 bg-gold-500" />
          </Link>

          <div className="mt-auto max-w-md">
            <h2 className="text-[2rem] leading-[1.15] font-semibold tracking-[-0.03em] text-balance xl:text-[2.375rem]">
              Own a share of Dubai&rsquo;s real estate market.
            </h2>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-brand-200">
              Tradewave pools investor capital into vetted, freehold Dubai property.
              You hold a stake in something real.
            </p>

            <ul className="mt-9 space-y-3.5 border-t border-white/10 pt-8">
              {TRUST_SIGNALS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-[0.875rem] text-brand-100">
                  <Icon className="size-4 shrink-0 text-gold-400" strokeWidth={2} />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      {/* ── Form panel ──────────────────────────────────────────────────── */}
      <main className="flex flex-col bg-canvas">
        {/* Compact header replaces the brand panel on small screens. */}
        <div className="flex items-center justify-between px-6 py-5 lg:hidden">
          <Link href="/" className="inline-flex items-center text-brand-900">
            <TradewaveLogo />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-14 lg:px-10 lg:py-10">
          <div className="w-full max-w-[25.5rem]">{children}</div>
        </div>

        <footer className="px-6 pb-7 text-center text-[0.75rem] text-muted-foreground lg:px-10">
          <span className="inline-flex items-center gap-1.5">
            <TradewaveMark className="size-3.5 text-brand-500 lg:hidden" />
            &copy; {new Date().getFullYear()} Tradewave. All rights reserved.
          </span>
        </footer>
      </main>
    </div>
  );
}
