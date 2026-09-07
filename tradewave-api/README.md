# tradewave-api

Express + TypeScript API for Tradewave. Phase 1 covers authentication and
referral capture.

## Running locally

```bash
npm install
cp .env.example .env      # then fill in the values
npx prisma migrate deploy # or `npm run db:migrate` when changing the schema
npm run dev               # http://localhost:4001
```

Port **4001**, not 4000 — another local project already owns 4000.

## Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Pooled connection (Supabase PgBouncer, **:6543**). Used at runtime. |
| `DIRECT_URL` | Direct connection (**:5432**). Used by `prisma migrate` and `studio`. |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `RESEND_API_KEY` | Leave **empty** to print verification links to the console instead of emailing. |
| `WEB_ORIGIN` | Exact origin of the Next.js app. Drives both CORS and the CSRF origin check. |
| `COOKIE_DOMAIN` | Empty in dev; `.tradewave.com` in production. |

### Prisma 7 notes

Prisma 7 moved connection URLs **out of `schema.prisma`** and into
`prisma.config.ts`, and the runtime client now needs a driver adapter:

- `prisma.config.ts` holds `datasource.url` — set to `DIRECT_URL`, because
  PgBouncer cannot run migrations.
- `src/lib/prisma.ts` builds the client with `@prisma/adapter-pg` on the pooled
  `DATABASE_URL`.

The `prisma` package's `latest` dist-tag currently points at an 8.0 release
candidate while `@prisma/client` is on 7.10. **Both are pinned to 7.10.0** — do
not run `npm update prisma` without pinning.

## Auth design

- **Passwords** — argon2id at OWASP parameters (19 MiB, t=2, p=1).
- **Access token** — 15 min JWT in an httpOnly cookie.
- **Refresh token** — 30 days, rotated on every use, stored only as a sha256
  hash, with **reuse detection**: replaying a revoked token revokes the entire
  session family. See `src/services/token.service.ts`.
- **No user enumeration** — `/register` and `/forgot-password` return identical
  responses whether or not the account exists, and both are padded to a constant
  minimum duration so latency does not leak the answer either.
- **CSRF** — `SameSite=Lax` plus an `Origin` allowlist on state-changing methods.

## Testing

```bash
npm test
```

Runs against a separate `tradewave_test` database, truncated between tests.

> Note when writing ad-hoc SQL: Prisma stores `DateTime` as
> `timestamp without time zone` in **UTC**. If your session timezone is not UTC,
> compare with `now() at time zone 'UTC'`, not bare `now()`.

## Money

Every amount is an integer number of **fils** (1 AED = 100 fils) held as a
`BigInt` — never a float. Rates are basis points (`850` = 8.50% p.a.). Money
leaves the API as a **string** of fils, because `JSON.stringify` throws on
BigInt and a JSON number would invite arithmetic on the client.

AED is pegged to USD at **3.6725** (unchanged since 1997), so the dollar figure
shown alongside a dirham amount is an exact conversion, not an estimate. The
rate still lives in the `FxRate` table rather than the code.
