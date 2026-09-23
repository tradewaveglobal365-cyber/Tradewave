/**
 * Every error the API returns to a client goes through AppError so the response
 * shape stays consistent:
 *   { error: { code, message, fields? } }
 */
export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors | undefined;

  constructor(status: number, code: string, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, fields?: FieldErrors) =>
  new AppError(400, 'BAD_REQUEST', message, fields);

export const validationFailed = (fields: FieldErrors) =>
  new AppError(422, 'VALIDATION_FAILED', 'Please check the highlighted fields.', fields);

export const unauthorized = (message = 'You need to sign in to continue.') =>
  new AppError(401, 'UNAUTHORIZED', message);

/**
 * The single error returned for an unknown account AND a bad password.
 * Distinguishing them would let an attacker enumerate who has an account.
 *
 * Says neither "email" nor "phone number": sign-in now takes either, and an
 * identifier that matches two accounts — legal, since User.phone is not unique
 * — lands here as well. Naming one credential would be wrong two ways out of
 * three.
 */
export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', "Those details don't match an account.");

export const accountLocked = (until: Date) =>
  new AppError(
    423,
    'ACCOUNT_LOCKED',
    `Too many failed attempts. Try again after ${until.toISOString()}.`,
  );

export const emailNotVerified = () =>
  new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to continue.');

/**
 * The account may sign in and read, but not move money.
 *
 * Its own code, distinct from ACCOUNT_SUSPENDED, because the two say opposite
 * things to the person reading them: one means "you are locked out", the other
 * means "your money is where you left it and you cannot move it right now".
 * A client that showed the wrong one would be telling somebody their funds were
 * gone.
 */
export const accountRestricted = (
  message = 'Your account is temporarily restricted, so money cannot move in or out. Your balance and holdings are unaffected — contact support.',
) => new AppError(403, 'ACCOUNT_RESTRICTED', message);

/** Withdrawals are blocked for this investor specifically. */
export const withdrawalsBlocked = (
  message = 'Withdrawals are on hold for your account. Contact support and we will explain why.',
) => new AppError(403, 'WITHDRAWALS_BLOCKED', message);

/** Withdrawals are paused for everybody. The reason is shown to the investor. */
export const withdrawalsPaused = (reason: string | null) =>
  new AppError(
    403,
    'WITHDRAWALS_PAUSED',
    reason
      ? `Withdrawals are paused right now: ${reason}`
      : 'Withdrawals are paused right now. They will reopen shortly.',
  );

export const accountSuspended = () =>
  new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact support.');

export const kycRequired = (
  message = 'Verify your identity before you can invest.',
) => new AppError(403, 'KYC_REQUIRED', message);

export const documentAlreadyVerified = () =>
  new AppError(
    409,
    'DOCUMENT_ALREADY_VERIFIED',
    'This document is already linked to a verified account.',
  );

export const kycPending = () =>
  new AppError(
    403,
    'KYC_PENDING',
    'Your identity check is still being reviewed. We will email you when it completes.',
  );

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found.') =>
  new AppError(404, 'NOT_FOUND', message);

export const invalidToken = (message = 'This link is invalid or has expired.') =>
  new AppError(400, 'INVALID_TOKEN', message);

export const tooManyRequests = (message = 'Too many requests. Please slow down.') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message);

export const insufficientFunds = (
  message = 'Your wallet balance is not enough for this investment.',
) => new AppError(422, 'INSUFFICIENT_FUNDS', message);

export const propertyUnavailable = (message = 'This property is no longer accepting investment.') =>
  new AppError(409, 'PROPERTY_UNAVAILABLE', message);

export const belowMinimumInvestment = (minimum: string) =>
  new AppError(422, 'BELOW_MINIMUM', `The minimum investment for this property is ${minimum}.`, {
    amountCents: `Minimum is ${minimum}`,
  });

/**
 * Deposits are closed because no USD/NGN rate is set, or no payment provider is
 * configured. Deliberately 503 rather than 500: nothing is broken, an operator
 * has simply not finished setting something up, and it will start working
 * without a code change.
 */
export const depositsUnavailable = (
  message = 'Funding is temporarily unavailable. Please try again shortly.',
) => new AppError(503, 'DEPOSITS_UNAVAILABLE', message);

/**
 * A feature whose provider has not been configured yet. Same 503 reasoning as
 * above, with its own code so a client can tell an unconfigured image store from
 * an unconfigured payment provider — they are fixed in different places.
 */
export const storageUnavailable = (
  message = 'Image storage is not configured yet.',
) => new AppError(503, 'STORAGE_UNAVAILABLE', message);

/**
 * The list of payout banks could not be fetched from the provider.
 *
 * 503 with its own code rather than a 500, for the same reason as the two
 * above, plus one specific to this route: a bank dropdown that arrives empty
 * looks identical to a bank dropdown that is still loading, and the client
 * cannot tell the difference from a 500 either. With this the form can say
 * what actually happened instead of rendering a select with nothing in it.
 */
export const banksUnavailable = (
  message = 'We could not load the list of banks. Please try again shortly.',
) => new AppError(503, 'BANKS_UNAVAILABLE', message);

// ── Withdrawals ──────────────────────────────────────────────────────────────

/** There is nowhere to send the money yet. */
export const noPayoutAccount = () =>
  new AppError(
    422,
    'NO_PAYOUT_ACCOUNT',
    'Add the bank account you want to be paid into before withdrawing.',
  );

/**
 * The destination changed too recently to pay out to it.
 *
 * Redirecting the payout account is the move an attacker makes with a stolen
 * session, and the change already emails the real owner. The hold is what turns
 * that email into something they can act on — without it the notice and the
 * money leave at the same moment.
 */
export const payoutAccountTooNew = (until: Date) =>
  new AppError(
    403,
    'PAYOUT_ACCOUNT_TOO_NEW',
    `For your security, withdrawals are held for 24 hours after the payout account changes. You can withdraw from ${until.toUTCString()}.`,
  );

export const belowMinimumWithdrawal = (minimum: string) =>
  new AppError(422, 'BELOW_MINIMUM_WITHDRAWAL', `The minimum withdrawal is ${minimum}.`, {
    amountCents: `Minimum is ${minimum}`,
  });

/**
 * One withdrawal at a time, per investor.
 *
 * Not a technical limit — concurrent requests would work — but a deliberate
 * one. It keeps "what is happening with my money" answerable with a single
 * row, and it means a compromised account cannot queue ten payouts before
 * anybody looks at the first.
 */
export const withdrawalPending = () =>
  new AppError(
    409,
    'WITHDRAWAL_PENDING',
    'You already have a withdrawal in progress. It has to finish before you can request another.',
  );

/**
 * Asked for outside the payout schedule.
 *
 * Carries the next opening so the client can count down to it rather than
 * saying "not now" and leaving the user to work out when.
 */
export const withdrawalsClosed = (opensAt: Date | null, schedule: string) =>
  new AppError(
    403,
    'WITHDRAWALS_CLOSED',
    opensAt
      ? `Withdrawals are open ${schedule}. The next one opens on ${opensAt.toUTCString()}.`
      : `Withdrawals are open ${schedule}.`,
  );

/** No rate set, or no payment provider configured. Same 503 reasoning as above. */
export const withdrawalsUnavailable = (
  message = 'Withdrawals are temporarily unavailable. Please try again shortly.',
) => new AppError(503, 'WITHDRAWALS_UNAVAILABLE', message);
