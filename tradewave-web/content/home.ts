/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOMEPAGE CONTENT — every string on the landing page lives here.
 *
 * The marketing page is pure content: it makes no API calls and imports nothing
 * from `lib/api.ts`, `lib/properties.ts` or `lib/money.ts`. Replacing the
 * client's real copy is therefore a single-file edit with no JSX involved.
 *
 * ⚠️  Anything marked `TODO(content)` is INVENTED and must not ship to
 * production. `app/(auth)/layout.tsx` sets the precedent: do not ship invented
 * metrics. Figures marked "derived" are computed from the seeded portfolio in
 * tradewave-api/prisma/seed.ts and are safe until that seed changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Whole-dollar formatter for marketing figures.
 *
 * Deliberately NOT `lib/money.ts`. That module parses the API's cents strings
 * for a UI that reconciles to the cent; this page has no API data and no cents
 * — it formats plain dollar numbers typed into this file and computed in the
 * calculator.
 */
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatUsd(dollars: number): string {
  return usd.format(dollars);
}

/** 780 -> "7.8%" — mirrors formatBps in lib/money.ts, kept local on purpose. */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/**
 * "$5M", "$1.96M" — for property values, where the exact dollar is noise and
 * the order of magnitude is the whole point.
 *
 * NOT `formatUsdCompact` from lib/money.ts. That one takes the API's cents
 * strings; this takes a plain dollar number typed into this file. Same job,
 * different input, deliberately not shared — this page is prerendered and has
 * no API to read from.
 */
export function formatUsdCompact(dollars: number): string {
  if (dollars >= 1_000_000) {
    const millions = dollars / 1_000_000;
    // Two decimals, then strip what they added: 1.96 stays, 5.00 -> 5.
    return `$${millions.toFixed(2).replace(/\.?0+$/, '')}M`;
  }
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return formatUsd(dollars);
}

/** 24 -> "24-month". Terms are always whole months on this platform. */
export function formatTerm(months: number): string {
  return `${months}-month`;
}

// ── The portfolio ────────────────────────────────────────────────────────────
//
// ⚠️  TODO(content): ALL SIX ARE PLACEHOLDER LISTINGS.
//
// This list mirrors PROPERTIES in tradewave-api/prisma/seed.ts — two copies of
// the same data now exist, so EDIT BOTH. The seed feeds the authenticated
// dashboard; this feeds the public homepage, which must stay static.
//
// The seed file's own header says it plainly: the photographs are generic
// Unsplash stock and NONE of them depicts the property described. Advertising
// these on a public page attaches a price, a yield and a "start investing" path
// to six assets that do not exist. Replace every entry with real, title-verified
// listings and real photography before this page goes in front of an investor.

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO LIST OF PROPERTIES IN THIS FILE ANY MORE.
 *
 * There used to be six, hardcoded, complete with prices, yields and a working
 * "start investing" link — because this page prerenders and a static page
 * cannot read a database. None of them existed. The homepage now regenerates
 * hourly from the real listings API instead (lib/public-properties.ts), so what
 * is advertised here is what is actually for sale, and there is no second copy
 * of the data to keep in sync.
 *
 * Anything in this file that would quote a NUMBER about current listings — an
 * entry price, a yield range — has been removed for the same reason. Those
 * figures are passed in from real data where they are shown at all, and when
 * there are no listings the sentence that would have quoted one is simply not
 * rendered. A fallback constant would just be the old invented number wearing
 * a different hat.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SITE = {
  name: 'Tradewave',
  tagline: 'Fractional ownership of freehold Dubai real estate.',
} as const;

// ── Navigation ───────────────────────────────────────────────────────────────
// In-page anchors only, plus /signup and /login.
//
// Deliberately NOT linking to /properties: proxy.ts lists it in
// PROTECTED_PREFIXES, so a logged-out visitor clicking it is bounced straight
// to /login — a poor first impression from a marketing page.

export const NAV_LINKS = [
  { href: '#properties', label: 'Properties' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#why-dubai', label: 'Why Dubai' },
  { href: '#returns', label: 'Returns' },
  { href: '#faq', label: 'FAQ' },
] as const;

// ── Hero ─────────────────────────────────────────────────────────────────────

export const HERO = {
  eyebrow: 'Now accepting founding investors',
  headline: 'Own a share of Dubai’s skyline.',
  subhead:
    'Tradewave divides freehold Dubai property into fractions you can actually afford. Title-verified before listing, registered with the Dubai Land Department, and held in your name.',
  primaryCta: { label: 'Create your account', href: '/signup' },
  secondaryCta: { label: 'See how it works', href: '#how-it-works' },
  // The entry-price chip is appended by hero.tsx from real listing data, so it
  // is absent rather than invented when nothing is listed.
  chips: ['DLD-registered title', 'Freehold ownership'],
  image: {
    // Reuses a photo already vetted for the Dubai seed data.
    src: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1600&q=75',
    alt: 'Downtown Dubai skyline at dusk',
  },
} as const;

// ── Trust bar ────────────────────────────────────────────────────────────────

export const TRUST_BAR = {
  regulators: [
    { label: 'Dubai Land Department', short: 'DLD' },
    { label: 'Real Estate Regulatory Agency', short: 'RERA' },
  ],
  // "$13M capital deployed" and "2,400+ investors onboarded" used to sit here.
  // Both were invented, and both were flagged in this file as invented. A
  // fabricated traction figure on a public investment page is not a content
  // TODO, so they are deleted rather than carried forward with a comment.
  //
  // trust-bar.tsx renders figures derived from real listings instead, and
  // nothing at all when there are none.
  stats: [],
} as const;

// ── About ────────────────────────────────────────────────────────────────────

export const ABOUT = {
  eyebrow: 'What Tradewave is',
  heading: 'Property ownership, divided.',
  body: [
    'A Palm Jumeirah villa costs five million dollars. That has always meant one of two things: you had five million, or you had nothing to do with it.',
    'Tradewave splits a single freehold property into fractions. You buy the fraction you can afford, and you own a real, proportional stake in a real, titled asset — not a fund unit, not a note, not exposure to an index.',
    'Every property is title-verified and registered before it is listed. Your holding, the terms you agreed to, and every dollar that moves are recorded on an auditable ledger you can inspect at any time.',
  ],
  points: [
    {
      title: 'A real asset, not a derivative',
      body: 'Your stake is in the property itself — freehold, titled, registered.',
    },
    {
      title: 'Terms locked at purchase',
      body: 'The rate and term you agree to are snapshotted onto your holding. Later changes to a listing cannot alter what you already own.',
    },
    {
      title: 'An auditable ledger',
      body: 'Every movement carries a balance snapshot, so any single entry can be verified on its own.',
    },
  ],
} as const;

// ── Property showcase ────────────────────────────────────────────────────────
//
// The card copy. The listings themselves are the PROPERTIES array above.
//
// Deliberately absent: funding progress, "% funded", investor counts. Those are
// live state that changes daily, and this page is prerendered at build time —
// a hardcoded funding bar is false within a week, and it is exactly the number
// a visitor would act on.

export const PROPERTY_SHOWCASE = {
  eyebrow: 'The portfolio',
  heading: 'What you would actually own.',
  description:
    'Six freehold assets, from a one-bedroom in Marina to a Signature Villa on the Palm. Each one shows its value, yield, term and minimum before you commit a dollar.',
  /** Sign-in is one redirect away — say so, rather than letting it ambush them. */
  cardCta: 'View property',
  allCta: { label: 'View the full portfolio', href: '/properties' },
  note: 'Signing in takes you straight to the property you picked.',
} as const;

// ── How it works ─────────────────────────────────────────────────────────────

export const HOW_IT_WORKS = {
  eyebrow: 'How it works',
  heading: 'Three steps, then it runs itself.',
  description:
    'Verification happens once, up front — so when you find a property worth owning, nothing stands between you and it.',
  steps: [
    {
      number: '01',
      title: 'Create and verify',
      body: 'Open an account and complete identity verification once. Every investor on the platform is verified before any funding takes place.',
    },
    {
      number: '02',
      title: 'Choose your property',
      body: 'Browse title-verified listings across Downtown, Marina, Business Bay, JVC and the Palm. Each one shows its value, yield, term and minimum before you commit a dollar.',
    },
    {
      number: '03',
      title: 'Earn, then exit',
      body: 'Returns accrue daily from the day your investment settles, at the rate locked in at purchase. At the end of the term your principal is returned in full.',
    },
  ],
} as const;

// ── Why Dubai ────────────────────────────────────────────────────────────────
//
// These are public, verifiable facts about UAE property law and taxation rather
// than claims about Tradewave. Still worth a compliance review before launch —
// thresholds and visa rules change.

export const WHY_DUBAI = {
  eyebrow: 'Why Dubai',
  heading: 'The math works differently here.',
  description:
    'Dubai is one of the few global cities where a foreign national can hold freehold title outright, and keep the rental income.',
  points: [
    {
      title: 'No personal income tax',
      body: 'The UAE levies no personal income tax on rental income. What the property yields is what you keep.',
    },
    {
      title: 'Freehold for foreign nationals',
      body: 'In designated freehold zones — the Palm, Downtown, Marina, Business Bay and others — foreign nationals hold full, permanent title.',
    },
    {
      title: 'Golden visa eligibility',
      body: 'Property holdings from AED 2 million can qualify a holder for the UAE’s ten-year residency visa.',
    },
    {
      title: 'Regulated and escrowed',
      body: 'The Dubai Land Department registers every transfer, and RERA governs escrow on development projects.',
    },
  ],
  // TODO(content): a yield comparison against London and New York would land
  // hard here, but needs a citable, dated source. Left out rather than invented.
  image: {
    src: 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200&q=75',
    alt: 'Aerial view of the Palm Jumeirah, Dubai',
  },
} as const;

// ── Auto-invest (the "autonomous" section) ───────────────────────────────────
//
// ⚠️  FRAMED THROUGHOUT AS FORTHCOMING. There is no auto-invest endpoint in
// tradewave-api. Every string below is future tense and the section carries a
// visible "in development" badge. Do not reword this into the present tense.

export const AUTO_INVEST = {
  eyebrow: 'In development',
  heading: 'Set your rules once. Let it compound.',
  description:
    'Autonomous investing is the next thing we are building. You will define the rules; Tradewave will do the rest, on repeat, without you logging in.',
  steps: [
    {
      title: 'You set the rules',
      body: 'Monthly amount, preferred term length, and the yield band you are comfortable with.',
    },
    {
      title: 'Capital allocates itself',
      body: 'As properties open, your capital is spread across them automatically — never concentrated in a single asset.',
    },
    {
      title: 'Returns reinvest',
      body: 'At maturity, principal and accrued return roll straight into the next allocation. Compounding, with nothing to remember.',
    },
  ],
  note: 'Autonomous investing is in active development and is not yet available. Nothing on this page commits Tradewave to a delivery date.',
} as const;

// ── Returns ──────────────────────────────────────────────────────────────────

export const RETURNS = {
  eyebrow: 'Returns',
  heading: 'What the portfolio actually pays.',
  // The live range is rendered by returns.tsx from real listings. This sentence
  // has to stand up on its own when there are none.
  description:
    'Prime assets yield less than commercial floors, and both are listed side by side. The spread is the point, not a mistake.',
  bands: [
    { label: 'Prime residential', example: 'Palm Jumeirah, Downtown', bps: 690 },
    { label: 'Mid-market residential', example: 'JVC, Creek Harbour', bps: 880 },
    { label: 'Commercial', example: 'Business Bay', bps: 1050 },
  ],
  calculator: {
    heading: 'Project your return',
    description:
      'Move the sliders to see what a holding would be worth at the end of its term.',
    // Bounds a slider needs to function, not claims about anything listed. The
    // yield presets are replaced with the real range whenever there is one —
    // see returns-calculator.tsx — and the disclaimer below covers the rest.
    amount: { min: 250, max: 500_000, step: 500, default: 25_000 },
    terms: [12, 24, 36],
    defaultTermMonths: 24,
    yields: [600, 900, 1200],
    defaultYieldBps: 900,
    disclaimer:
      'Illustrative only. Projections use the declared rate for a property over its stated term and are not a guarantee. Property investment carries risk, including loss of capital; past performance does not indicate future returns.',
  },
} as const;

// ── Security & trust ─────────────────────────────────────────────────────────
//
// Every claim here is verified against tradewave-api, not invented:
//   · terms snapshot   prisma/schema.prisma:185-186 duplicates annualReturnBps
//                      and termMonths onto the holding at purchase
//   · ledger snapshot  prisma/schema.prisma:221 — balanceAfterCents, commented
//                      "snapshot, so a row can be audited in isolation"
//   · integer money    every amount is BigInt cents, serialised as strings
//
// ⚠️  This section makes NO claim about Tradewave's own licensing, regulatory
// standing, or custody of client funds — the same line the FAQ holds, for the
// same reason: legal has not confirmed the position in writing. Describe what
// the SYSTEM does and what DUBAI PROPERTY LAW does. Do not let this drift into
// "Tradewave is regulated" or "your funds are held in escrow."

export const SECURITY = {
  eyebrow: 'Safeguards',
  heading: 'Where your money actually sits.',
  description:
    'Trust in a platform like this should not rest on a promise. Here is what is built into the system itself.',
  points: [
    {
      title: 'Your terms cannot change under you',
      body: 'The rate and term you agree to are copied onto your holding at the moment of purchase. If the listing is later edited, your holding is untouched — what you bought is what you own.',
    },
    {
      title: 'A ledger that audits itself',
      body: 'Every movement of money records the resulting balance alongside it. Any single row can be checked on its own, without replaying the account from the beginning.',
    },
    {
      title: 'Exact amounts, never approximations',
      body: 'Money is held as whole cents end to end — integers, never floating point. Balances do not drift by a cent over thousands of entries, because there is nothing to round.',
    },
    {
      title: 'Every investor is verified',
      body: 'Identity verification is completed once, before any funding takes place. Nobody moves money on this platform anonymously.',
    },
    {
      title: 'Title registered before listing',
      body: 'The Dubai Land Department registers every property transfer in the emirate, and RERA governs escrow on development projects. A property is title-verified before it appears on Tradewave.',
    },
  ],
} as const;

// ── Comparison ───────────────────────────────────────────────────────────────
//
// Qualitative on purpose. A savings rate or a REIT yield would have to be
// invented, and a comparison table is where an invented number does the most
// damage — it is read as a like-for-like fact. The only figure here is
// Tradewave's own minimum, which is computed from the portfolio above.
//
// The honest differentiator is the "What you own" row, not the returns.

export const COMPARISON = {
  eyebrow: 'The alternatives',
  heading: 'Why not just buy one?',
  description:
    'The case for fractional ownership is not that it beats every alternative. It is that the alternatives ask for something most people do not have.',
  columns: ['Tradewave', 'Buying outright', 'A REIT', 'Savings account'],
  rows: [
    {
      label: 'Entry cost',
      cells: [
        'A share, not a whole property',
        'Seven figures, plus fees and transfer costs',
        'Low — a share price',
        'Anything',
      ],
    },
    {
      label: 'What you own',
      cells: [
        'A titled share of one specific freehold property',
        'The whole property, in your name',
        'A unit in a fund that owns property',
        'A cash balance',
      ],
    },
    {
      label: 'Time to get in',
      cells: [
        'Verified once, then minutes',
        'Months — viewings, financing, conveyancing, registration',
        'Minutes',
        'Minutes',
      ],
    },
    {
      label: 'Ongoing work',
      cells: [
        'None — no tenants, no service charges, no maintenance',
        'You are the landlord',
        'None',
        'None',
      ],
    },
    {
      label: 'Getting out',
      cells: [
        'At the end of the stated term',
        'Sell the property — months, and a buyer has to appear',
        'Sell the units',
        'Immediately',
      ],
    },
  ],
  // The row that is not in the table: this is the honest cost of the model.
  note: 'The trade-off is liquidity. Buying outright leaves you free to sell whenever a buyer appears; a Tradewave holding runs to the end of its term. Invest on the assumption your capital is committed for the full period.',
} as const;

// ── Testimonials ────────────────────────────────────────────────────────────
//
// REMOVED. Four investor quotes used to sit here, attributed to people who do
// not exist. This file said so itself — the section carried `placeholder: true`
// and a note explaining that monograms were used instead of stock photographs
// because "pairing a fabricated quote with a stock photograph of a real person
// is a materially worse thing to ship than the quote alone".
//
// Both are the same problem. A fabricated endorsement on a page selling an
// investment is not a content placeholder, so the section is gone rather than
// carried forward behind a flag. Put it back when there are real investors who
// have agreed to be quoted.

// ── FAQ ──────────────────────────────────────────────────────────────────────

export const FAQ = {
  eyebrow: 'Questions',
  heading: 'The things worth asking first.',
  items: [
    {
      q: 'What is the minimum investment?',
      a: 'It depends on the property — larger prime assets set a higher minimum than mid-market ones. Every listing shows its own minimum, in full, before you commit a dollar to it.',
    },
    {
      q: 'What exactly do I own?',
      a: 'A proportional stake in a single, specific freehold property — not a fund unit or a share in Tradewave. The property is title-verified and registered before it is listed, and your holding is recorded against it.',
    },
    {
      q: 'How are returns calculated?',
      a: 'Simple interest on your principal at the rate declared for that property, accruing by whole elapsed days and capped at the end of the term. The rate and term are snapshotted onto your holding at purchase, so a later change to the listing cannot alter your terms.',
    },
    {
      q: 'Can I exit before the term ends?',
      a: 'Not yet. Holdings currently run to the end of their stated term, at which point your principal is returned. A secondary market for exiting early is something we intend to build, but it does not exist today and you should invest on the assumption that your capital is committed for the full term.',
    },
    {
      // TODO(content): confirm the real fee schedule with the client. The answer
      // below is deliberately non-numeric so it is not false as written, but it
      // should be replaced with the actual figures before launch.
      q: 'What fees does Tradewave charge?',
      a: 'There is no fee to open or hold an account. Any fee attached to an investment is shown in full on the listing, alongside the rate and term, before you commit a dollar to it.',
      placeholder: true,
    },
    {
      // TODO(content): confirm Tradewave's own licensing and regulatory standing
      // in writing. The answer below states only what is true of Dubai property
      // transactions generally and makes NO claim about Tradewave's own status —
      // do not strengthen it until legal has confirmed the position.
      q: 'Is Tradewave regulated?',
      a: 'Every property listed is registered with the Dubai Land Department, and RERA governs escrow on development projects. Tradewave’s own licensing and regulatory details are set out in full in our terms of service.',
      placeholder: true,
    },
    {
      q: 'Do I need to be a UAE resident?',
      a: 'No. Dubai’s designated freehold zones are open to foreign nationals, and you can invest from outside the UAE. You will still need to complete identity verification.',
    },
    {
      q: 'Will I owe tax on my returns?',
      a: 'The UAE levies no personal income tax on rental income. You may still owe tax where you are resident — Tradewave does not provide tax advice, and you should speak to an adviser in your own jurisdiction.',
    },
  ],
} as const;

// ── Final CTA ────────────────────────────────────────────────────────────────

export const CTA = {
  heading: 'Start with a verified account.',
  body: 'Verification takes a few minutes and costs nothing. You can browse the full portfolio before committing to anything.',
  primary: { label: 'Create your account', href: '/signup' },
  secondary: { label: 'Sign in', href: '/login' },
} as const;

// ── Sticky mobile CTA ────────────────────────────────────────────────────────
//
// Short by necessity: this bar is roughly 340px wide on the narrowest phones and
// shares the row with a button.

export const STICKY_CTA = {
  label: 'Own a share of',
  value: 'Dubai property',
  action: { label: 'Get started', href: '/signup' },
} as const;

// ── Footer ───────────────────────────────────────────────────────────────────

export const FOOTER = {
  columns: [
    {
      title: 'Product',
      links: [
        { label: 'How it works', href: '#how-it-works' },
        { label: 'Why Dubai', href: '#why-dubai' },
        { label: 'Returns', href: '#returns' },
        { label: 'FAQ', href: '#faq' },
      ],
    },
    {
      title: 'Company',
      // TODO(content): none of these routes exist yet.
      links: [
        { label: 'About', href: '/about' },
        { label: 'Contact', href: '/contact' },
      ],
    },
    {
      title: 'Legal',
      // TODO(content): neither route exists yet.
      links: [
        { label: 'Terms of service', href: '/terms' },
        { label: 'Privacy policy', href: '/privacy' },
      ],
    },
  ],
  // TODO(content): real social handles needed.
  social: [
    { label: 'X', href: '#' },
    { label: 'LinkedIn', href: '#' },
    { label: 'Instagram', href: '#' },
  ],
  disclaimer:
    'Tradewave facilitates fractional investment in freehold Dubai real estate. Property investment carries risk, including the loss of capital invested. Returns shown are the declared rate for each property over its stated term and are not guaranteed. Past performance does not indicate future returns. Nothing on this site constitutes financial, legal or tax advice.',
} as const;
