import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { validationFailed } from '../../lib/errors';
import { namesMatch } from '../../lib/name-match';
import { paymentProvider } from '../../services/payments';
import type { Bank } from '../../services/payments/types';

/**
 * The bank account money will eventually be paid out to.
 *
 * One per user, replaced in place. The whole of the interesting behaviour is in
 * one question: does this account belong to the person who verified their
 * identity? Paying an account that is not the investor's is the pattern
 * anti-money-laundering controls exist to stop, and it is far cheaper to answer
 * now than after a withdrawal has cleared.
 */

export interface PayoutAccountView {
  bankCode: string;
  bankName: string;
  /** Masked. The full number is never sent back to a browser. */
  accountNumberMasked: string;
  accountName: string;
  /** Whether the bank confirmed the name, or the user merely asserted it. */
  nameResolved: boolean;
  updatedAt: Date;
}

export interface SetPayoutAccountInput {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

/** Last four only — enough to recognise, not enough to redirect money to. */
function mask(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

export async function listBanks(): Promise<Bank[]> {
  return paymentProvider.listBanks('NGN');
}

export async function getPayoutAccount(userId: string): Promise<PayoutAccountView | null> {
  const row = await prisma.payoutAccount.findUnique({ where: { userId } });
  if (!row) return null;

  return {
    bankCode: row.bankCode,
    bankName: row.bankName,
    accountNumberMasked: mask(row.accountNumber),
    accountName: row.accountName,
    nameResolved: row.nameResolved,
    updatedAt: row.updatedAt,
  };
}

/**
 * Sets or replaces the account, refusing one that does not name the investor.
 *
 * The caller has already passed requireKyc, so the user has a verified name to
 * check against — that is why the gate is there, rather than for consistency.
 */
export async function setPayoutAccount(
  userId: string,
  input: SetPayoutAccountInput,
): Promise<PayoutAccountView> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  const verifiedName = `${user.firstName} ${user.lastName}`;

  const banks = await paymentProvider.listBanks('NGN');
  const bank = banks.find((b) => b.code === input.bankCode);
  // Checked against the provider's own list rather than trusted from the form:
  // a code we invent is a payout that fails long after the user has gone.
  if (!bank) {
    throw validationFailed({ bankCode: 'Choose a bank from the list.' });
  }

  // Ask the bank who owns this account. When the provider can tell us, ITS
  // answer is what gets checked — the user's typing is then irrelevant, which is
  // the whole point. Klasha returns null today, so the typed name is the
  // fallback and the row records that nobody independent confirmed it.
  const resolved = await paymentProvider
    .resolveAccountName(input.bankCode, input.accountNumber)
    .catch((err: unknown) => {
      // A provider outage must not become "your name does not match".
      logger.warn({ err, userId }, 'Account name resolution failed — falling back to typed name');
      return null;
    });

  const nameToCheck = resolved ?? input.accountName;
  const result = namesMatch(verifiedName, nameToCheck);

  if (!result.matches) {
    logger.warn(
      { userId, nameResolved: resolved !== null, matched: result.matched },
      'Payout account refused: name does not match verified identity',
    );
    throw validationFailed({
      accountName: resolved
        ? `This account belongs to ${resolved}, which does not match your verified identity (${verifiedName}). Money can only be paid to an account in your own name.`
        : `This does not match your verified identity (${verifiedName}). Money can only be paid to an account in your own name — contact support if the account is genuinely yours.`,
    });
  }

  const row = await prisma.payoutAccount.upsert({
    where: { userId },
    create: {
      userId,
      provider: paymentProvider.name,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: input.accountNumber,
      // Store what the BANK said when it said anything, so the record reflects
      // the account rather than what somebody typed about it.
      accountName: resolved ?? input.accountName,
      nameResolved: resolved !== null,
    },
    update: {
      provider: paymentProvider.name,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: input.accountNumber,
      accountName: resolved ?? input.accountName,
      nameResolved: resolved !== null,
    },
  });

  logger.info({ userId, bankCode: bank.code, nameResolved: row.nameResolved }, 'Payout account set');

  return {
    bankCode: row.bankCode,
    bankName: row.bankName,
    accountNumberMasked: mask(row.accountNumber),
    accountName: row.accountName,
    nameResolved: row.nameResolved,
    updatedAt: row.updatedAt,
  };
}
