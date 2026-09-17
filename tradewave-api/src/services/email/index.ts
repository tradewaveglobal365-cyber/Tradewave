import { Resend } from 'resend';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import type {
  DepositCreditedEmail,
  DuplicateSignupEmail,
  EmailService,
  InvestmentConfirmedEmail,
  KycDecidedEmail,
  PasswordResetEmail,
  PayoutAccountChangedEmail,
  WithdrawalRequestedEmail,
  WithdrawalSettledEmail,
  ReferralBonusEmail,
  VerificationEmail,
} from './types';
import {
  depositCreditedTemplate,
  duplicateSignupTemplate,
  investmentConfirmedTemplate,
  kycDecidedTemplate,
  passwordResetTemplate,
  payoutAccountChangedTemplate,
  withdrawalRequestedTemplate,
  withdrawalSettledTemplate,
  referralBonusTemplate,
  verificationTemplate,
} from './templates';

export type { EmailService } from './types';

/**
 * Dev driver. Prints the link to stdout so the whole auth flow is testable
 * before a sending domain has finished DNS verification.
 */
class ConsoleEmailService implements EmailService {
  private print(kind: string, to: string, url: string): void {
    logger.info({ to, url }, `[email:${kind}]`);
    // Deliberately also raw-printed: the pretty logger truncates long URLs and
    // you need to be able to click this one.
    console.log(`\n  ✉  ${kind} → ${to}\n     ${url}\n`);
  }

  async sendVerification({ to, verifyUrl }: VerificationEmail): Promise<void> {
    this.print('verify-email', to, verifyUrl);
  }

  async sendPasswordReset({ to, resetUrl }: PasswordResetEmail): Promise<void> {
    this.print('password-reset', to, resetUrl);
  }

  async sendDuplicateSignupNotice({ to, loginUrl }: DuplicateSignupEmail): Promise<void> {
    this.print('duplicate-signup', to, loginUrl);
  }

  // The four below carry no link worth clicking in development, so they log a
  // one-line summary instead — enough to see that the trigger fired.
  async sendKycDecided({ to, approved, adoptedName }: KycDecidedEmail): Promise<void> {
    logger.info({ to, approved, adoptedName }, '[email:kyc-decided]');
  }

  async sendDepositCredited({ to, amountCredited }: DepositCreditedEmail): Promise<void> {
    logger.info({ to, amountCredited }, '[email:deposit-credited]');
  }

  async sendInvestmentConfirmed({
    to,
    propertyTitle,
    amount,
  }: InvestmentConfirmedEmail): Promise<void> {
    logger.info({ to, propertyTitle, amount }, '[email:investment-confirmed]');
  }

  async sendPayoutAccountChanged({
    to,
    accountNumberMasked,
  }: PayoutAccountChangedEmail): Promise<void> {
    logger.info({ to, accountNumberMasked }, '[email:payout-account-changed]');
  }

  async sendWithdrawalRequested({ to, amount }: WithdrawalRequestedEmail): Promise<void> {
    logger.info({ to, amount }, '[email:withdrawal-requested]');
  }

  async sendWithdrawalSettled({ to, paid, amount }: WithdrawalSettledEmail): Promise<void> {
    logger.info({ to, paid, amount }, '[email:withdrawal-settled]');
  }

  async sendReferralBonus({ to, amount }: ReferralBonusEmail): Promise<void> {
    logger.info({ to, amount }, '[email:referral-bonus]');
  }
}

class ResendEmailService implements EmailService {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  private async send(to: string, subject: string, html: string, text: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      // Surface it in logs but do not throw: a failed verification email must
      // not roll back a successful registration. The user can hit "resend".
      logger.error({ to, subject, error }, 'Failed to send email');
    }
  }

  async sendVerification({ to, firstName, verifyUrl }: VerificationEmail): Promise<void> {
    const t = verificationTemplate(firstName, verifyUrl);
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendPasswordReset({ to, firstName, resetUrl }: PasswordResetEmail): Promise<void> {
    const t = passwordResetTemplate(firstName, resetUrl);
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendDuplicateSignupNotice({
    to,
    firstName,
    loginUrl,
    resetUrl,
  }: DuplicateSignupEmail): Promise<void> {
    const t = duplicateSignupTemplate(firstName, loginUrl, resetUrl);
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendKycDecided({
    to,
    firstName,
    approved,
    reason,
    adoptedName,
    url,
  }: KycDecidedEmail): Promise<void> {
    const t = kycDecidedTemplate(firstName, approved, url, reason, adoptedName);
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendDepositCredited({
    to,
    firstName,
    amountReceived,
    amountCredited,
    newBalance,
    url,
  }: DepositCreditedEmail): Promise<void> {
    const t = depositCreditedTemplate(
      firstName,
      amountReceived,
      amountCredited,
      newBalance,
      url,
    );
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendInvestmentConfirmed({
    to,
    firstName,
    propertyTitle,
    amount,
    annualReturn,
    termMonths,
    maturesOn,
    url,
  }: InvestmentConfirmedEmail): Promise<void> {
    const t = investmentConfirmedTemplate(
      firstName,
      propertyTitle,
      amount,
      annualReturn,
      termMonths,
      maturesOn,
      url,
    );
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendPayoutAccountChanged({
    to,
    firstName,
    bankName,
    accountNumberMasked,
    accountName,
    url,
  }: PayoutAccountChangedEmail): Promise<void> {
    const t = payoutAccountChangedTemplate(
      firstName,
      bankName,
      accountNumberMasked,
      accountName,
      url,
    );
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendWithdrawalRequested({
    to,
    firstName,
    amount,
    fee,
    bankName,
    accountNumberMasked,
    url,
  }: WithdrawalRequestedEmail): Promise<void> {
    const t = withdrawalRequestedTemplate(
      firstName,
      amount,
      fee,
      bankName,
      accountNumberMasked,
      url,
    );
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendWithdrawalSettled({ to, ...rest }: WithdrawalSettledEmail): Promise<void> {
    const t = withdrawalSettledTemplate(rest);
    await this.send(to, t.subject, t.html, t.text);
  }

  async sendReferralBonus({
    to,
    firstName,
    inviteeName,
    amount,
    rate,
    url,
  }: ReferralBonusEmail): Promise<void> {
    const t = referralBonusTemplate(firstName, inviteeName, amount, rate, url);
    await this.send(to, t.subject, t.html, t.text);
  }
}

export const emailService: EmailService = env.RESEND_API_KEY
  ? new ResendEmailService(env.RESEND_API_KEY)
  : new ConsoleEmailService();

if (!env.RESEND_API_KEY) {
  logger.warn('RESEND_API_KEY is empty — using the console email driver.');
}
