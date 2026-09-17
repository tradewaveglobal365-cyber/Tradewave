import { API_URL } from './api';

/**
 * Real listings, for the public homepage.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The homepage used to carry its own hardcoded copy of the listings, because
 * it prerenders at build time and a static page cannot read a database. That
 * meant six invented properties — with prices, yields and a "start investing"
 * path — were advertised on a public page while the database held none.
 *
 * Incremental regeneration solves the original problem properly: the page is
 * still served as static HTML, and it is rebuilt from the API every hour. No
 * second copy of the data, and nothing to keep in sync by hand.
 *
 * ── Why a failure returns nothing rather than throwing ────────────────────
 * This runs at build time. An API that is asleep on Render's free tier, or a
 * deploy that happens while the database is migrating, must not fail the build
 * or — far worse — leave a stale page quoting numbers nobody can verify. An
 * empty list renders an honest "listings are being prepared" state.
 */

export interface PublicProperty {
  id: string;
  slug: string;
  title: string;
  summary: string;
  area: string;
  city: string;
  images: string[];
  /** Cents, as strings — the API never sends money as a JSON number. */
  totalValueCents: string;
  minInvestmentCents: string;
  annualReturnBps: number;
  termMonths: number;
  status: string;
}

/** How long a prerendered homepage may quote figures before it is rebuilt. */
export const SHOWCASE_REVALIDATE_SECONDS = 3600;

/** How many listings the homepage grid shows. */
const SHOWCASE_LIMIT = 6;

export async function getShowcaseProperties(): Promise<PublicProperty[]> {
  try {
    const res = await fetch(`${API_URL}/properties?page=1&perPage=${SHOWCASE_LIMIT}`, {
      next: { revalidate: SHOWCASE_REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: PublicProperty[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

/**
 * The numbers the marketing copy is allowed to quote.
 *
 * Null when there is nothing listed. That is deliberate and it is the whole
 * point of this module: with no listings there is no honest yield range and no
 * honest entry price, so every sentence that would have quoted one has to say
 * something else instead. A fallback constant here would just be the old fake
 * numbers wearing a different hat.
 */
export interface MarketingStats {
  minYieldBps: number;
  maxYieldBps: number;
  avgYieldBps: number;
  /** Cents. The cheapest way into any current listing. */
  minTicketCents: number;
  count: number;
}

export function deriveStats(properties: PublicProperty[]): MarketingStats | null {
  if (properties.length === 0) return null;

  const yields = properties.map((p) => p.annualReturnBps);
  const tickets = properties.map((p) => Number(p.minInvestmentCents));

  return {
    minYieldBps: Math.min(...yields),
    maxYieldBps: Math.max(...yields),
    avgYieldBps: Math.round(yields.reduce((a, b) => a + b, 0) / yields.length),
    minTicketCents: Math.min(...tickets),
    count: properties.length,
  };
}
