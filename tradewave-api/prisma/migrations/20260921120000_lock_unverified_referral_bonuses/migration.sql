-- How much of a wallet's balance is not spendable.
--
-- An ENCUMBRANCE, not a second balance: "balanceCents" stays exactly the sum of
-- the wallet's LedgerEntry rows, and availableCents is derived on read as
-- "balanceCents" - "lockedCents" and never stored.
ALTER TABLE "Wallet" ADD COLUMN "lockedCents" BIGINT NOT NULL DEFAULT 0;

-- Retro-lock bonuses already paid to people who never verified.
--
-- This matters more than it looks. Those bonuses are unspendable TODAY only
-- because requireKyc sits on every route that could move them — invest,
-- withdraw, payout account. The migration that removes those gates would
-- therefore RELEASE this money on deploy day, which is the exact outcome the
-- lock exists to prevent. Locking it here is what makes the gate removal a
-- no-op for money that has already been paid.
--
-- LEAST clamps the wallet that an admin adjustment has already taken below its
-- own bonus total, so the CHECK below cannot fail on a legitimate history.
UPDATE "Wallet" w
SET "lockedCents" = LEAST(
      w."balanceCents",
      COALESCE((
        SELECT SUM(le."amountCents")
        FROM "LedgerEntry" le
        WHERE le."walletId" = w.id
          AND le."type" = 'REFERRAL_BONUS'
      ), 0)
    )
FROM "User" u
WHERE u.id = w."userId"
  AND u."kycStatus" <> 'VERIFIED';

-- Added AFTER the backfill, so a wallet that violates it fails the migration
-- rather than surfacing later as a negative available balance.
--
-- This is what makes the LEAST clamp in adjustBalance unmissable instead of
-- remembered: any future write path that forgets to clamp the lock when it
-- debits fails loudly at the database.
ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_lockedCents_within_balance"
  CHECK ("lockedCents" >= 0 AND "lockedCents" <= "balanceCents");

-- The investors are Nigerian. The column has defaulted to the market the
-- PROPERTIES are in since the first migration, which is not the same question.
ALTER TABLE "User" ALTER COLUMN "country" SET DEFAULT 'NG';
