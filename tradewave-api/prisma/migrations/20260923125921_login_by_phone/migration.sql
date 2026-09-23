-- Sign-in now accepts a phone number as well as an email address.
--
-- Two statements, and the order matters: normalise what is already stored
-- BEFORE the index is built over it, so the index is built once on final values.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backfill legacy phone numbers to E.164.
--
-- Numbers have been normalised on the way in since the open-door change, but
-- rows written before it hold whatever was typed ("0803 000 0000"), and no
-- phone sign-in will ever match those. This mirrors normalizePhone's three
-- confident cases from src/lib/phone.ts.
--
-- Anything else is LEFT EXACTLY AS TYPED. We cannot tell a foreign number
-- missing its '+' from a local one with a digit missing, and guessing wrong
-- writes a working number belonging to a stranger into somebody's account —
-- which, now that the column is a sign-in key, is worse than leaving a number
-- that simply does not work.
UPDATE "User"
SET "phone" = CASE
  WHEN regexp_replace("phone", '\D', '', 'g') ~ '^0[0-9]{10}$'
    THEN '+234' || substring(regexp_replace("phone", '\D', '', 'g') from 2)
  WHEN regexp_replace("phone", '\D', '', 'g') ~ '^234[0-9]{10}$'
    THEN '+' || regexp_replace("phone", '\D', '', 'g')
  WHEN regexp_replace("phone", '\D', '', 'g') ~ '^[0-9]{10}$'
    THEN '+234' || regexp_replace("phone", '\D', '', 'g')
  ELSE "phone"
END
WHERE "phone" IS NOT NULL AND "phone" NOT LIKE '+%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Make the lookup an index scan.
--
-- NOT unique, deliberately — see the comment on User.phone in schema.prisma.
-- A plain index also cannot fail on existing data, which is what makes this
-- migration safe to run against a database already holding accounts.
-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");
