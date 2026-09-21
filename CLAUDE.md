# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fractional real-estate investment platform. Dubai properties, Nigerian investors,
a USD ledger. Two independent apps in one repo, no workspace tooling and no
shared package — each has its own `package.json` and is installed separately.

| Path | Stack | Deploys to |
| --- | --- | --- |
| `tradewave-api/` | Express 5 + Prisma 7 + PostgreSQL (Supabase) | Render (`render.yaml`) |
| `tradewave-web/` | Next.js 16 App Router + React 19 + Tailwind v4 | Vercel |

## Commands

Run everything from inside the app directory — there are no root-level scripts.

```bash
# API — http://localhost:4001  (4001, not 4000: another local project owns 4000)
cd tradewave-api
npm install
npm run dev              # tsx watch
npm run build            # prisma generate && tsc
npm run typecheck        # tsc --noEmit  — the API has no linter
npm run db:migrate       # prisma migrate dev (schema changes)
npm run db:deploy        # prisma migrate deploy (apply only)
npm run db:studio
npm run db:seed          # property listings; db:seed:demo for a populated demo account
npm run admin:grant      # promote a user to ADMIN

# Web — http://localhost:3000, requires the API on :4001
cd tradewave-web
npm install
npm run dev
npm run build
npm run lint             # eslint; typecheck with `npx tsc --noEmit`
```

### Tests

Vitest + supertest, API only. They hit a **real local Postgres**, not a mock:

```bash
createdb tradewave_test          # once; or set TEST_DATABASE_URL
npm test                         # vitest run
npm run test:watch

npx vitest run src/test/withdrawal.test.ts        # one file
npx vitest run src/test/auth.test.ts -t "rotates" # one test by name
```

`src/test/setup.ts` overwrites every credential env var **before any module
loads**, because `config/env.ts` parses `process.env` at import time. When you
add a provider env var, pin it empty there too — otherwise a developer with a
half-filled `.env` gets boot-time env errors instead of their actual failure.
`vitest.config.mts` disables file parallelism: the suites share one database and
truncate between tests.

Emails have no assertions on their appearance — `npx tsx scripts/preview-emails.ts <dir>`
renders all of them to files to look at. It never sends.

## Architecture

### The money rule

**Every amount is an integer number of US cents held as a `BigInt`.** Never a
float, never a `number` near the database. Rates are basis points (`850` = 8.50%).
`src/lib/money.ts` is the only place conversions live; `tradewave-web/lib/money.ts`
is its display-side counterpart and **performs no arithmetic**.

Three currencies, three different roles — do not conflate them:

- **USD** — the ledger. Every balance, principal and payout.
- **AED** — display only, via a hardcoded peg (`AED_PER_USD_X10000 = 36_725`,
  fixed since 1997). Exact arithmetic, not a rate lookup.
- **NGN/GHS** — floats, so never stored as a balance. Appears only on a `Deposit`
  row as the amount received and the rate applied at that moment. Which one is
  live is the single `COLLECTION_CURRENCY` switch, which drives the Klasha
  account currency, the FX quote currency, the payout bank list and the payout
  together — deliberately one switch, because a mismatch silently credits money
  at the wrong rate.

Money crosses the wire as a **string** of cents: `app.set('json replacer', bigintReplacer)`
in `app.ts`, because `JSON.stringify` throws on BigInt, and a JSON number would
invite the frontend to do arithmetic on it.

> ⚠️ `tradewave-api/README.md`'s "Money" section still describes the pre-September
> design (AED fils as the ledger unit). The `20260913110000_usd_redenomination`
> migration replaced it. Trust `src/lib/money.ts`.

### The ledger

`Wallet.balanceCents` is a **cache**. It is never written outside the same
transaction as its `LedgerEntry` — a balance that has drifted from its history is
unauditable. `LedgerEntry.reference` is unique and acts as the idempotency key, so
a replayed payment webhook cannot double-credit; the second insert just violates
the constraint.

Concurrency is handled in the database, not in application checks. The guard
sits in the `WHERE` clause so Postgres arbitrates and the loser simply matches
zero rows — see `debitSpendable` in `wallet.service.ts` and the property
allocation claim in `investment.service.ts`, both raw SQL because the comparison
spans columns. Follow that shape rather than read-then-write.

### Identity is not a gate; the referral lock is

Identity verification gates **nothing**. An unverified investor can get a
deposit account, invest, set a payout account and withdraw — the product accepts
everyone, and `requireKyc` is kept only so one gate can be restored quickly if
Klasha's terms demand it.

What verification does gate is **referral earnings**, enforced on the money
rather than at a door:

- `Wallet.lockedCents` is an **encumbrance, not a second balance**.
  `balanceCents` stays exactly the sum of the ledger; `availableCents =
  balanceCents - lockedCents` is derived on read and never stored.
- `creditReferralBonus` raises the lock when the referrer is not `VERIFIED`.
  `applyDecision` zeroes it on verification — **housekeeping only**.
- **The lock binds on `kycStatus`, not on the column.** Every guard reads it as
  `CASE WHEN u."kycStatus" = 'VERIFIED' THEN 0 ELSE w."lockedCents" END`. If
  spendability depended on the release having been *written*, a bonus credited
  in the instant a KYC decision commits would stay locked forever — there is no
  second release event. Binding to `kycStatus` makes verification monotonic.
- Spending goes through `wallet.service.debitSpendable` (raw SQL, joined to
  `User`). `adjustBalance` is the deliberate exception: an admin clawback is
  guarded on the **full** balance and clamps the lock down with `LEAST`, because
  reversing a fraudulent bonus must always work.
- A `CHECK` constraint pins `0 <= lockedCents <= balanceCents`. Any debit path
  that forgets to clamp fails loudly at the database.
- The release writes **no ledger entry**. A zero-amount row would collide on
  `reference` after an admin-forced re-verification, make quiet months emit
  statements, and render as a green `+$0.00` on the PDF.

The name lock is the control that replaced the payout-account KYC gate:
`isNameEditable` refuses a rename once a `PayoutAccount` exists, so nobody can
resolve a stranger's account name, adopt it, and withdraw there.

Accrued value is **derived on read** (`modules/investment/accrual.ts`), never
stored — there is no nightly batch to miss or double-apply. Investment terms are
**snapshotted** at purchase, so editing a property never changes what an existing
investor agreed to.

Property listings are data, not code: `prisma/seed.ts` is placeholder content
meant to be replaced with the client's real listings and re-run. Nothing in the
app hardcodes a property.

### API module layout

`src/modules/<domain>/` = `*.routes.ts` (wiring + guards) → `*.service.ts`
(logic + transactions) → `schemas.ts` (zod). Cross-cutting concerns:

- `config/env.ts` — **the only place that reads `process.env`.** Parsed once at
  boot with zod; a missing var is a loud startup exit, not an `undefined` that
  surfaces as a broken login later. Provider credentials are validated as
  all-or-nothing groups.
- `lib/errors.ts` — every client-facing error is an `AppError`, giving the single
  envelope `{ error: { code, message, fields? } }`.
- `middleware/auth.ts` — separate guards, deliberately not collapsed:
  `requireAuth` (valid token), `requireActive` (may move money — reads
  `UserStatus`), `requireWithdrawalsAllowed`, `requireRole`. These read the
  **database, not the JWT**: reading status from a 15-minute token made freezes
  late, and the web proxy's silent refresh let a suspended session renew itself
  forever. Reading your own data is generally `requireAuth` only.
  `requireKyc` still exists but is **wired to nothing** — see below.

### External providers are swappable drivers

`services/{payments,kyc,email}/index.ts` each export one already-configured
instance — `paymentProvider`, `kycProvider`, `emailService` — picking a real
driver or a **stub** by whether credentials are set (`services/storage` does the
same with plain functions and an `isStorageConfigured()` check). Import the
instance; do not construct a driver at a call site.

The stubs exist so the whole flow is demoable with no vendor account — but
**every stub refuses to act in production** (KYC returns `PENDING` forever,
payments issue and confirm nothing). A stub must never put money in a balance on
a deployment a client is watching. Preserve that when adding a driver.

Live integrations: **Klasha** (naira collection accounts + payouts; 3DES-encrypted
bodies, bearer token minted from *account* credentials), **Didit** (identity,
webhook-driven), **Resend** (email; empty key = console driver), **Supabase
Storage** (listing photos, uploaded through our API so authorisation is
`requireRole('ADMIN')` and the service-role key never reaches a browser).

### The scheduler

`services/scheduler/` runs in the API process — one tick a minute, no separate
cron service to deploy or keep env vars in step with. Four jobs (`sweeps`,
`maturity-notices`, `abandoned-identity`, `monthly-statements`), run sequentially.

Two independent protections, and **a new job needs both**:

1. A database lock (`ScheduledJob` row, claimed with a lease) makes a job
   single-writer across instances.
2. A **marker column** the job narrows its own query by and then fills in
   (`maturityNoticeSentAt`, `lastStatementPeriod`, …), written with a conditional
   `updateMany` so the write *is* the gate. This makes it at-most-once against
   the same instance running again an hour later.

The scheduler is skipped under test; `scheduler.test.ts` calls `tick()` and the
jobs directly.

### Web app

- **`lib/types.ts` is a hand-maintained contract mirror.** There is no shared
  package, so changing an API payload means editing that file *and*
  `tradewave-api/src/modules/*/schemas.ts` in the same change.
- **Route protection is two-layer.** `proxy.ts` (Next 16 renamed `middleware` to
  `proxy`) only checks that a session cookie *exists* and opportunistically
  refreshes it — it cannot verify the JWT without the API's secret. The real gate
  is `getCurrentUser()` in the dashboard/admin layouts. It also captures `?ref=`.
- **Cookies drive the deployment shape.** The API sets `SameSite=Lax`, which a
  browser drops as third-party across `vercel.app` → `onrender.com`. So in
  production `API_ORIGIN` makes `next.config.ts` rewrite `/api/*` server-side and
  `NEXT_PUBLIC_API_URL` becomes the relative `/api/v1`. Locally the browser calls
  `localhost:4001` directly. `lib/api.ts` resolves a different base per runtime;
  Server Components forward the `Cookie` header explicitly (`lib/session.ts`).
- **Design tokens only.** All colours live in `app/globals.css` under `@theme`.
  Never write a raw hex in a component — add a token. `brand-*` is chrome, `gain`
  is a deliberately *different* green for positive numbers, so a filled button is
  never mistakable for a return figure.
- **Inputs are `h-11` with `text-base`.** The shadcn preset's `h-8`/`text-sm` is
  below 16px, which makes iOS Safari zoom on focus and break the layout mid-signup.
- `tradewave-web/CLAUDE.md` → `AGENTS.md` carries a block that `next dev` writes
  and re-adds: this Next.js has breaking changes from training data, so read
  `node_modules/next/dist/docs/` before writing Next-specific code.

## Prisma 7 specifics

Connection URLs moved **out of `schema.prisma`**:

- `prisma.config.ts` holds `datasource.url` = `DIRECT_URL` (port 5432) — CLI only.
  PgBouncer cannot run migrations.
- `src/lib/prisma.ts` builds the runtime client with `@prisma/adapter-pg` on the
  pooled `DATABASE_URL` (port 6543). It does not read `prisma.config.ts`.

`prisma` and `@prisma/client` are both **pinned to 7.10.0** — the `latest`
dist-tag points at an 8.0 release candidate. Do not `npm update prisma`.

Writing ad-hoc SQL: Prisma stores `DateTime` as `timestamp without time zone` in
UTC, so compare with `now() at time zone 'UTC'`, not bare `now()`.

## Conventions

- Commit subjects are sentence-case and describe the **user-visible effect**, not
  the mechanism: "Pay investors back when their term ends", "Stop trapping people
  in a review nobody is working". No conventional-commit prefixes.
- Comments in this codebase explain *why*, often at length, and frequently record
  a decision that was made the other way once and broke something. Match that —
  and when you change such code, update the reasoning rather than deleting it.
- Security posture to preserve: no user enumeration (`/register` and
  `/forgot-password` return identical, duration-padded responses), argon2id at
  OWASP parameters, refresh tokens stored only as sha256 hashes and rotated with
  reuse detection that revokes the whole session family, CSRF via `SameSite=Lax`
  plus an `Origin` allowlist on state-changing methods.
