import Link from 'next/link';
import { TradewaveLogo } from '@/components/brand/logo';
import { FOOTER, SITE } from '@/content/home';

/**
 * Footer. The risk disclaimer is not decoration — this page quotes yields and
 * projects returns, so the qualification travels with it.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-hairline bg-surface">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
          <div className="max-w-xs">
            <Link href="/" className="inline-flex text-brand-900">
              <TradewaveLogo />
            </Link>
            <p className="mt-3.5 text-[0.875rem] leading-relaxed text-muted-foreground">
              {SITE.tagline}
            </p>
            <div className="mt-5 flex items-center gap-4">
              {FOOTER.social.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="text-[0.8125rem] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-brand-700 hover:underline"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          {FOOTER.columns.map((column) => (
            <div key={column.title}>
              <h3 className="text-[0.8125rem] font-semibold text-foreground">
                {column.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {/* Anchors stay plain <a>; routes go through next/link. */}
                    {link.href.startsWith('#') ? (
                      <a
                        href={link.href}
                        className="text-[0.875rem] text-muted-foreground underline-offset-4 transition-colors hover:text-brand-700 hover:underline"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[0.875rem] text-muted-foreground underline-offset-4 transition-colors hover:text-brand-700 hover:underline"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-hairline pt-8">
          <p className="max-w-4xl text-[0.75rem] leading-relaxed text-muted-foreground">
            {FOOTER.disclaimer}
          </p>
          <p className="mt-5 text-[0.75rem] text-muted-foreground">
            &copy; {new Date().getFullYear()} {SITE.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
