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

/** A term ended and the money is spendable again. */
export interface InvestmentMaturedEmail {
  to: string;
  firstName: string;
  propertyTitle: string;
  principal: string;
  earned: string;
  total: string;
  url: string;
}

/**
 * The account password changed.
 *
 * A security notice rather than a receipt: it goes to the account address
 * whether or not the change was legitimate, because the whole point is to reach
 * the real owner when it was not them. It carries a reset link so somebody who
 * did not do this has an immediate way to take the account back.
 */
export interface PasswordChangedEmail {
  to: string;
  firstName: string;
  /** How many other devices were signed out, for the copy. */
  otherSessionsEnded: number;
  resetUrl: string;
}

/**
 * Staff changed the state of somebody's account.
 *
 * Carries the reason, because a freeze with no explanation is the shape of a
 * scam and the investor will assume the worst — correctly, if we say nothing.
 */
export interface AccountStatusChangedEmail {
  to: string;
  firstName: string;
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'RESTRICTED' | 'SUSPENDED';
  reason: string;
  url: string;
}

/** They have to verify their identity again. */
export interface KycResetRequiredEmail {
  to: string;
  firstName: string;
  reason: string;
  url: string;
}

/**
 * Money was added to or taken from a wallet by hand.
 *
 * Always sent. Money appearing or disappearing with no explanation is
 * indistinguishable from a bug, or from theft.
 */
export interface BalanceAdjustedEmail {
  to: string;
  firstName: string;
  credit: boolean;
  amount: string;
  newBalance: string;
  reason: string;
  url: string;
}

// ── Added with the email overhaul ────────────────────────────────────────────

/** Sent once the address is actually confirmed, not when the link is issued. */
export interface WelcomeEmail {
  to: string;
  firstName: string;
  url: string;
}

/**
 * A sign-in from a device we have not seen on this account.
 *
 * A security notice. Changing a payout account and changing a password both
 * send one already; an unrecognised sign-in is the FIRST move an attacker
 * makes, and it was the only one of the three that was silent.
 */
export interface NewDeviceSignInEmail {
  to: string;
  firstName: string;
  device: string;
  when: string;
  resetUrl: string;
}

/** Five failed attempts. Somebody is guessing, and the owner should know. */
export interface AccountLockedEmail {
  to: string;
  firstName: string;
  minutes: number;
  resetUrl: string;
}

/** The provider escalated the check to a human. No action needed. */
export interface KycInReviewEmail {
  to: string;
  firstName: string;
  url: string;
}

/** The check could not be started because OUR provider was unreachable. */
export interface KycUnavailableEmail {
  to: string;
  firstName: string;
  url: string;
}

/** They started verifying and never finished. The session link still works. */
export interface KycAbandonedEmail {
  to: string;
  firstName: string;
  url: string;
}

/**
 * Money arrived and could not be credited yet.
 *
 * The worst silence in the product before this existed: real naira leaves an
 * investor's bank, the wallet does not move, and nothing is said. From their
 * side that is indistinguishable from the transfer vanishing.
 */
export interface DepositHeldEmail {
  to: string;
  firstName: string;
  amountReceived: string;
  url: string;
}

/** A week before a term ends. */
export interface MaturityApproachingEmail {
  to: string;
  firstName: string;
  propertyTitle: string;
  payout: string;
  maturesOn: string;
  days: number;
  url: string;
}

/**
 * Released and sent to the bank.
 *
 * This is the moment the naira figure stops being an estimate — the rate is
 * pinned at approval — so it is the first time the investor can be told what
 * will actually land.
 */
export interface WithdrawalApprovedEmail {
  to: string;
  firstName: string;
  amount: string;
  naira: string;
  rate: string;
  bankName: string;
  accountNumberMasked: string;
  url: string;
}

/** Withdrawals blocked or unblocked for this investor specifically. */
export interface WithdrawalsBlockedEmail {
  to: string;
  firstName: string;
  blocked: boolean;
  reason: string;
  url: string;
}

/** Withdrawals paused for everybody. */
export interface WithdrawalsPausedEmail {
  to: string;
  firstName: string;
  reason: string;
  url: string;
}

/** Somebody used your referral link. Named by initial, as /referrals does. */
export interface ReferralSignupEmail {
  to: string;
  firstName: string;
  inviteeName: string;
  rate: string;
  url: string;
}

/** The scheduled monthly statement. */
export interface MonthlyStatementEmail {
  to: string;
  firstName: string;
  period: string;
  openingBalance: string;
  closingBalance: string;
  invested: string;
  earned: string;
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
  sendInvestmentMatured(input: InvestmentMaturedEmail): Promise<void>;
  sendPasswordChanged(input: PasswordChangedEmail): Promise<void>;
  sendAccountStatusChanged(input: AccountStatusChangedEmail): Promise<void>;
  sendKycResetRequired(input: KycResetRequiredEmail): Promise<void>;
  sendBalanceAdjusted(input: BalanceAdjustedEmail): Promise<void>;

  sendWelcome(input: WelcomeEmail): Promise<void>;
  sendNewDeviceSignIn(input: NewDeviceSignInEmail): Promise<void>;
  sendAccountLocked(input: AccountLockedEmail): Promise<void>;
  sendKycInReview(input: KycInReviewEmail): Promise<void>;
  sendKycUnavailable(input: KycUnavailableEmail): Promise<void>;
  sendKycAbandoned(input: KycAbandonedEmail): Promise<void>;
  sendDepositHeld(input: DepositHeldEmail): Promise<void>;
  sendMaturityApproaching(input: MaturityApproachingEmail): Promise<void>;
  sendWithdrawalApproved(input: WithdrawalApprovedEmail): Promise<void>;
  sendWithdrawalsBlocked(input: WithdrawalsBlockedEmail): Promise<void>;
  sendWithdrawalsPaused(input: WithdrawalsPausedEmail): Promise<void>;
  sendReferralSignup(input: ReferralSignupEmail): Promise<void>;
  sendMonthlyStatement(input: MonthlyStatementEmail): Promise<void>;
}
