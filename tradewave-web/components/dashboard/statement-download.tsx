'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { browserApiUrl } from '@/lib/api';

/**
 * Picks a period and downloads a statement.
 *
 * The download is a plain link, not a fetch. The session cookie is SameSite=Lax
 * and a download is a top-level GET, so the browser sends it — which means no
 * blob juggling, no object URLs to revoke, and the file lands in Downloads the
 * way every other file does. Fetching it into memory first would also mean
 * holding somebody's financial record in a JavaScript variable for no gain.
 */

/** Presets, because almost nobody wants an arbitrary range. */
function presets(): { label: string; from: Date; to: Date }[] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const startOfMonth = new Date(Date.UTC(y, m, 1));
  const startOfLastMonth = new Date(Date.UTC(y, m - 1, 1));
  const endOfLastMonth = new Date(Date.UTC(y, m, 0));

  return [
    { label: 'This month', from: startOfMonth, to: now },
    { label: 'Last month', from: startOfLastMonth, to: endOfLastMonth },
    { label: 'This year', from: new Date(Date.UTC(y, 0, 1)), to: now },
  ];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function StatementDownload() {
  const options = presets();
  const [from, setFrom] = useState(iso(options[0]!.from));
  const [to, setTo] = useState(iso(options[0]!.to));

  const valid = from !== '' && to !== '' && from <= to;
  const href = `${browserApiUrl}/documents/statement?from=${from}&to=${to}`;

  return (
    <div className="rounded-xl border border-hairline bg-surface p-5">
      <p className="text-[0.875rem] font-medium text-foreground">Account statement</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
        Every deposit, investment, return and withdrawal in a period, with a running balance.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = from === iso(option.from) && to === iso(option.to);
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setFrom(iso(option.from));
                setTo(iso(option.to));
              }}
              aria-pressed={active}
              className={`h-8 rounded-lg border px-3 text-[0.75rem] font-medium transition-colors ${
                active
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-input text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="stmt-from" className="block text-[0.75rem] font-medium text-foreground">
            From
          </label>
          <input
            id="stmt-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 h-10 rounded-lg border border-input bg-transparent px-3 text-[0.8125rem] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          />
        </div>
        <div>
          <label htmlFor="stmt-to" className="block text-[0.75rem] font-medium text-foreground">
            To
          </label>
          <input
            id="stmt-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 h-10 rounded-lg border border-input bg-transparent px-3 text-[0.8125rem] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          />
        </div>

        <Button asChild disabled={!valid} className="h-10 gap-1.5">
          {/* target=_blank so the PDF opens in its own tab rather than
              replacing the dashboard — people expect to glance at a statement
              and come back. */}
          <a href={valid ? href : undefined} target="_blank" rel="noopener noreferrer">
            <Download className="size-3.5" />
            Download PDF
          </a>
        </Button>
      </div>

      {!valid ? (
        <p role="alert" className="mt-2 text-[0.75rem] text-destructive">
          The end of the period is before the start.
        </p>
      ) : null}
    </div>
  );
}
