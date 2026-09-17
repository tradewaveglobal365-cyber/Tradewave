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

/**
 * A withdrawal has been asked for, and the dollars have already left the wallet.
 *
 * A security notice rather than a receipt, for the same reason
 * PayoutAccountChangedEmail is: money leaving is the thing an attacker with a
 * stolen session does, and this is the message that reaches the real owner
 * while it can still be stopped.
 */
export interface WithdrawalRequestedEmail {
  to: string;
  firstName: string;
  amount: string;
  fee: string;
  bankName: string;
  accountNumberMasked: string;
  url: string;
}

/** A withdrawal reached its end state, one way or the other. */
export interface WithdrawalSettledEmail {
  to: string;
  firstName: string;
  paid: boolean;
  amount: string;
  bankName: string;
  accountNumberMasked: string;
  /** Set when paid: what actually landed, and the rate it was converted at. */
  naira?: string | undefined;
  rate?: string | undefined;
  /** Set when it was not paid, in whoever's words refused it. */
  reason?: string | undefined;
  url: string;
}

/**
 * Somebody you invited invested, and you have been paid for it.
 *
 * The invitee is named the way /referrals names them — first name and last
 * initial. Referring someone is not a reason to be handed their full identity,
 * and an email is the easiest place to leak it by accident.
 */
export interface ReferralBonusEmail {
  to: string;
  firstName: string;
  inviteeName: string;
  amount: string;
  /** The rate it was calculated at, e.g. "1%". */
  rate: string;
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
  sendWithdrawalRequested(input: WithdrawalRequestedEmail): Promise<void>;
  sendWithdrawalSettled(input: WithdrawalSettledEmail): Promise<void>;
  sendReferralBonus(input: ReferralBonusEmail): Promise<void>;
}
