-- Redenominate the ledger from AED fils to USD cents.
--
-- The dirham is pegged at 3.6725 to the dollar, so this is an exact conversion
-- rather than a snapshot of a floating rate: cents = fils * 10000 / 36725.
--
-- RENAME rather than DROP/ADD. Prisma would happily generate the latter from
-- the schema diff, which would silently delete every balance in the database.

-- ── Property ────────────────────────────────────────────────────────────────
ALTER TABLE "Property" RENAME COLUMN "totalValueFils" TO "totalValueCents";
ALTER TABLE "Property" RENAME COLUMN "minInvestmentFils" TO "minInvestmentCents";
ALTER TABLE "Property" RENAME COLUMN "fundedFils" TO "fundedCents";

UPDATE "Property" SET
  "totalValueCents"    = ("totalValueCents"    * 10000) / 36725,
  "minInvestmentCents" = ("minInvestmentCents" * 10000) / 36725,
  "fundedCents"        = ("fundedCents"        * 10000) / 36725;

-- ── Investment ──────────────────────────────────────────────────────────────
ALTER TABLE "Investment" RENAME COLUMN "principalFils" TO "principalCents";
UPDATE "Investment" SET "principalCents" = ("principalCents" * 10000) / 36725;

-- ── Deposit ─────────────────────────────────────────────────────────────────
ALTER TABLE "Deposit" RENAME COLUMN "amountFils" TO "amountCents";
UPDATE "Deposit" SET "amountCents" = ("amountCents" * 10000) / 36725;
ALTER TABLE "Deposit" ALTER COLUMN "provider" SET DEFAULT 'klasha';

-- ── Wallet and ledger ───────────────────────────────────────────────────────
ALTER TABLE "LedgerEntry" RENAME COLUMN "amountFils" TO "amountCents";
ALTER TABLE "LedgerEntry" RENAME COLUMN "balanceAfterFils" TO "balanceAfterCents";
ALTER TABLE "Wallet" RENAME COLUMN "balanceFils" TO "balanceCents";

UPDATE "LedgerEntry" SET "amountCents" = ("amountCents" * 10000) / 36725;

-- Converting each row independently would break the invariant the ledger exists
-- to hold: truncation is per-row, so the snapshots would no longer be the
-- running sum of the amounts. Recompute them from the converted amounts instead.
WITH running AS (
  SELECT id,
         SUM("amountCents") OVER (
           PARTITION BY "walletId"
           ORDER BY "createdAt", id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS balance
  FROM "LedgerEntry"
)
UPDATE "LedgerEntry" l
SET "balanceAfterCents" = running.balance
FROM running
WHERE running.id = l.id;

-- Same reasoning for the cached balance. A wallet with no entries has nothing to
-- rebuild from, so its stored value is converted directly rather than zeroed.
UPDATE "Wallet" w SET "balanceCents" = CASE
  WHEN EXISTS (SELECT 1 FROM "LedgerEntry" l WHERE l."walletId" = w.id)
    THEN (SELECT SUM(l."amountCents") FROM "LedgerEntry" l WHERE l."walletId" = w.id)
  ELSE ("balanceCents" * 10000) / 36725
END;

-- ── FxRate: now USD -> NGN only ─────────────────────────────────────────────
-- The AED/USD peg moved into lib/money.ts as a constant. It is not a rate that
-- needs maintaining, and leaving it here invites someone to "update" it.
ALTER TABLE "FxRate" RENAME COLUMN "filsPerUnit" TO "minorPerUnit";
ALTER TABLE "FxRate" ADD COLUMN "midMinorPerUnit" BIGINT;
ALTER TABLE "FxRate" ADD COLUMN "setByUserId" UUID;
ALTER TABLE "FxRate" ALTER COLUMN "baseCurrency" SET DEFAULT 'USD';
ALTER TABLE "FxRate" ALTER COLUMN "quoteCurrency" SET DEFAULT 'NGN';

DELETE FROM "FxRate" WHERE "baseCurrency" = 'AED' AND "quoteCurrency" = 'USD';
