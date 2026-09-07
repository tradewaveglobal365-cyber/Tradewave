# tradewave-web

Next.js 16 (App Router) + TypeScript + Tailwind v4 frontend for Tradewave.

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

Requires `tradewave-api` running on **:4001**.

Market: **Dubai, UAE**. Currency is AED (stored as integer fils server-side);
the frontend formats with `en-AE` and never performs money arithmetic.

## Design system — Forest & Gold

All tokens live in `app/globals.css` under `@theme`. **Never write a raw hex in
a component** — if a colour is missing, add a token.

The rule that keeps the palette coherent:

| Role | Token | Used for |
|---|---|---|
| Brand | `brand-900` … `brand-50` | Chrome and interaction: headers, buttons, links |
| Accent | `gold-500` | Premium/badges. Used sparingly — one hairline per screen |
| Positive | `gain` | Numbers going up. **A different green from the brand on purpose** |
| Negative | `loss` | Numbers going down |
| Waiting | `pending` | Unverified / awaiting KYC |

A filled button must never be mistakable for a `+12.4%` return, which is why
`brand-700` and `gain` are deliberately distinct greens.

## Structure

- `app/(auth)/*` — split-screen auth screens. The brand panel carries the trust
  signals and stays on every auth page.
- `app/(dashboard)/*` — requires a session; the layout calls `getCurrentUser()`.
- `proxy.ts` — route protection **and** `?ref=` referral capture (Next 16
  renamed the `middleware` convention to `proxy`).
- `lib/types.ts` — the single mirrored copy of the API contract. Change it
  together with `tradewave-api/src/modules/*/schemas.ts`.

## Two things that are load-bearing

1. **Route protection is two-layer.** `proxy.ts` only checks that a session
   cookie *exists* — it cannot verify the JWT signature without the API's
   secret. The real gate is `getCurrentUser()` in the dashboard layout.
2. **Inputs are `h-11` (44px) on mobile with `text-base`.** The shadcn preset
   ships `h-8`/`text-sm`; below 16px iOS Safari zooms the page on focus and
   breaks the layout mid-signup.
