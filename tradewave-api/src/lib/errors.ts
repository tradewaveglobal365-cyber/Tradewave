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
 * The single error returned for a bad email AND a bad password. Distinguishing
 * them would let an attacker enumerate which emails have accounts.
 */
export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

export const accountLocked = (until: Date) =>
  new AppError(
    423,
    'ACCOUNT_LOCKED',
    `Too many failed attempts. Try again after ${until.toISOString()}.`,
  );

export const emailNotVerified = () =>
  new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to continue.');

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

export const insufficientFunds = () =>
  new AppError(
    422,
    'INSUFFICIENT_FUNDS',
    'Your wallet balance is not enough for this investment.',
  );

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
