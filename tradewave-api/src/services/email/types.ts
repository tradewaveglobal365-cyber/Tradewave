export interface VerificationEmail {
  to: string;
  firstName: string;
  verifyUrl: string;
}

export interface PasswordResetEmail {
  to: string;
  firstName: string;
  resetUrl: string;
}

/** Sent when someone tries to register with an email that already has an account. */
export interface DuplicateSignupEmail {
  to: string;
  firstName: string;
  loginUrl: string;
  resetUrl: string;
}

/**
 * The outcome of an identity check.
 *
 * Didit sends nothing to users itself — send_notification_emails is false on
 * the session — so a decision reaches the investor only if we tell them.
 */
export interface KycDecidedEmail {
  to: string;
  firstName: string;
  approved: boolean;
  /** Present on a refusal, in the provider's words. */
  reason?: string | undefined;
  /**
   * Set when the verified document carried a different name from the account,
   * so the email can explain why their profile now reads differently.
   */
  adoptedName?: string | undefined;
  url: string;
}

/** Naira landed and became dollars. */
export interface DepositCreditedEmail {
  to: string;
  firstName: string;
  /** Formatted for display — the service does no money formatting of its own. */
  amountReceived: string;
  amountCredited: string;
  newBalance: string;
  url: string;
}

export interface InvestmentConfirmedEmail {
  to: string;
  firstName: string;
  propertyTitle: string;
  amount: string;
  annualReturn: string;
  termMonths: number;
  maturesOn: string;
  url: string;
}

/**
 * Security notice: the destination for this investor's money changed.
 *
 * Sent to the account address whether or not the change was legitimate, because
 * the whole point is to reach the real owner when it was not.
 */
export interface PayoutAccountChangedEmail {
  to: string;
  firstName: string;
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
  url: string;
}

export interface EmailService {
  sendVerification(input: VerificationEmail): Promise<void>;
  sendPasswordReset(input: PasswordResetEmail): Promise<void>;
  sendDuplicateSignupNotice(input: DuplicateSignupEmail): Promise<void>;
  sendKycDecided(input: KycDecidedEmail): Promise<void>;
  sendDepositCredited(input: DepositCreditedEmail): Promise<void>;
  sendInvestmentConfirmed(input: InvestmentConfirmedEmail): Promise<void>;
  sendPayoutAccountChanged(input: PayoutAccountChangedEmail): Promise<void>;
}
