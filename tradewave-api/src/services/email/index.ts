import { Resend } from 'resend';
import { env, isProduction } from '../../config/env';
import { logger } from '../../lib/logger';
import type { RenderedEmail } from './layout';
import * as t from './templates';
import type {
  AccountLockedEmail,
  AccountStatusChangedEmail,
  BalanceAdjustedEmail,
  DepositCreditedEmail,
  DepositHeldEmail,
  DuplicateSignupEmail,
  EmailService,
  InvestmentConfirmedEmail,
  InvestmentMaturedEmail,
  KycAbandonedEmail,
  KycDecidedEmail,
  KycInReviewEmail,
  KycResetRequiredEmail,
  KycUnavailableEmail,
  MaturityApproachingEmail,
  MonthlyStatementEmail,
  NewDeviceSignInEmail,
  PasswordChangedEmail,
  PasswordResetEmail,
  PayoutAccountChangedEmail,
  ReferralBonusEmail,
  ReferralSignupEmail,
  VerificationEmail,
  WelcomeEmail,
  WithdrawalApprovedEmail,
  WithdrawalRequestedEmail,
  WithdrawalSettledEmail,
  WithdrawalsBlockedEmail,
  WithdrawalsPausedEmail,
} from './types';

export type { EmailService } from './types';

/**
 * Which emails exist, and what they say.
 *
 * ── Why the templates are called in the BASE class ────────────────────────
 * Because they used not to be. The console driver logged a one-line summary and
 * never touched a template, so in development and in CI the whole of
 * templates.ts was dead code — a render-time throw was invisible until it
 * reached production, where four unguarded call sites in auth.service would
 * have turned it into a 500 on a successful registration.
 *
 * Every method here renders, then hands a finished email to `deliver`. The two
 * drivers differ only in what they do with it, so dev exercises exactly the
 * code production runs.
 */
abstract class BaseEmailService implements EmailService {
  protected abstract deliver(to: string, email: RenderedEmail): Promise<void>;

  // ── Account ──────────────────────────────────────────────────────────────
  async sendVerification(i: VerificationEmail): Promise<void> {
    await this.deliver(i.to, t.verificationTemplate(i.firstName, i.verifyUrl));
  }
  async sendWelcome(i: WelcomeEmail): Promise<void> {
    await this.deliver(i.to, t.welcomeTemplate(i.firstName, i.url));
  }
  async sendPasswordReset(i: PasswordResetEmail): Promise<void> {
    await this.deliver(i.to, t.passwordResetTemplate(i.firstName, i.resetUrl));
  }
  async sendDuplicateSignupNotice(i: DuplicateSignupEmail): Promise<void> {
    await this.deliver(i.to, t.duplicateSignupTemplate(i.firstName, i.loginUrl, i.resetUrl));
  }
  async sendPasswordChanged(i: PasswordChangedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.passwordChangedTemplate(i.firstName, i.otherSessionsEnded, i.resetUrl),
    );
  }
  async sendNewDeviceSignIn(i: NewDeviceSignInEmail): Promise<void> {
    await this.deliver(i.to, t.newDeviceSignInTemplate(i));
  }
  async sendAccountLocked(i: AccountLockedEmail): Promise<void> {
    await this.deliver(i.to, t.accountLockedTemplate(i.firstName, i.minutes, i.resetUrl));
  }
  async sendAccountStatusChanged(i: AccountStatusChangedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.accountStatusChangedTemplate(i.firstName, i.status, i.reason, i.url),
    );
  }

  // ── Identity ─────────────────────────────────────────────────────────────
  async sendKycDecided(i: KycDecidedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.kycDecidedTemplate(
        i.firstName,
        i.approved,
        i.url,
        i.reason,
        i.adoptedName,
        i.unlockedReferralBonus,
      ),
    );
  }
  async sendKycInReview(i: KycInReviewEmail): Promise<void> {
    await this.deliver(i.to, t.kycInReviewTemplate(i.firstName, i.url));
  }
  async sendKycResetRequired(i: KycResetRequiredEmail): Promise<void> {
    await this.deliver(i.to, t.kycResetRequiredTemplate(i.firstName, i.reason, i.url));
  }
  async sendKycUnavailable(i: KycUnavailableEmail): Promise<void> {
    await this.deliver(i.to, t.kycUnavailableTemplate(i.firstName, i.url));
  }
  async sendKycAbandoned(i: KycAbandonedEmail): Promise<void> {
    await this.deliver(i.to, t.kycAbandonedTemplate(i.firstName, i.url));
  }

  // ── Money in ─────────────────────────────────────────────────────────────
  async sendDepositCredited(i: DepositCreditedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.depositCreditedTemplate(
        i.firstName,
        i.amountReceived,
        i.amountCredited,
        i.newBalance,
        i.url,
      ),
    );
  }
  async sendDepositHeld(i: DepositHeldEmail): Promise<void> {
    await this.deliver(i.to, t.depositHeldTemplate(i.firstName, i.amountReceived, i.url));
  }

  // ── Investing ────────────────────────────────────────────────────────────
  async sendInvestmentConfirmed(i: InvestmentConfirmedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.investmentConfirmedTemplate(
        i.firstName,
        i.propertyTitle,
        i.amount,
        i.annualReturn,
        i.termMonths,
        i.maturesOn,
        i.url,
      ),
    );
  }
  async sendMaturityApproaching(i: MaturityApproachingEmail): Promise<void> {
    await this.deliver(i.to, t.maturityApproachingTemplate(i));
  }
  async sendInvestmentMatured(i: InvestmentMaturedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.investmentMaturedTemplate(
        i.firstName,
        i.propertyTitle,
        i.principal,
        i.earned,
        i.total,
        i.url,
      ),
    );
  }

  // ── Money out ────────────────────────────────────────────────────────────
  async sendPayoutAccountChanged(i: PayoutAccountChangedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.payoutAccountChangedTemplate(
        i.firstName,
        i.bankName,
        i.accountNumberMasked,
        i.accountName,
        i.url,
      ),
    );
  }
  async sendWithdrawalRequested(i: WithdrawalRequestedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.withdrawalRequestedTemplate(
        i.firstName,
        i.amount,
        i.fee,
        i.bankName,
        i.accountNumberMasked,
        i.url,
      ),
    );
  }
  async sendWithdrawalApproved(i: WithdrawalApprovedEmail): Promise<void> {
    await this.deliver(i.to, t.withdrawalApprovedTemplate(i));
  }
  async sendWithdrawalSettled({ to, ...rest }: WithdrawalSettledEmail): Promise<void> {
    await this.deliver(to, t.withdrawalSettledTemplate(rest));
  }
  async sendWithdrawalsBlocked(i: WithdrawalsBlockedEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.withdrawalsBlockedTemplate(i.firstName, i.blocked, i.reason, i.url),
    );
  }
  async sendWithdrawalsPaused(i: WithdrawalsPausedEmail): Promise<void> {
    await this.deliver(i.to, t.withdrawalsPausedTemplate(i.firstName, i.reason, i.url));
  }
  async sendBalanceAdjusted({ to, ...rest }: BalanceAdjustedEmail): Promise<void> {
    await this.deliver(to, t.balanceAdjustedTemplate(rest));
  }

  // ── Referrals and statements ─────────────────────────────────────────────
  async sendReferralSignup(i: ReferralSignupEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.referralSignupTemplate(i.firstName, i.inviteeName, i.rate, i.url),
    );
  }
  async sendReferralBonus(i: ReferralBonusEmail): Promise<void> {
    await this.deliver(
      i.to,
      t.referralBonusTemplate(i.firstName, i.inviteeName, i.amount, i.rate, i.url, i.locked),
    );
  }
  async sendMonthlyStatement(i: MonthlyStatementEmail): Promise<void> {
    await this.deliver(i.to, t.monthlyStatementTemplate(i));
  }
}

/**
 * Dev driver. Prints the subject and any link to stdout so the whole flow is
 * testable before a sending domain has finished DNS verification.
 *
 * It renders the real template first — see the note on BaseEmailService.
 */
class ConsoleEmailService extends BaseEmailService {
  protected async deliver(to: string, email: RenderedEmail): Promise<void> {
    logger.info({ to, subject: email.subject }, '[email]');

    // The pretty logger truncates long URLs and you need to be able to click
    // this one, so it is raw-printed as well.
    const link = /https?:\/\/\S+/.exec(email.text)?.[0];
    console.log(`\n  ✉  ${email.subject} → ${to}${link ? `\n     ${link}` : ''}\n`);
  }
}

class ResendEmailService extends BaseEmailService {
  private readonly client: Resend;

  constructor(apiKey: string) {
    super();
    this.client = new Resend(apiKey);
  }

  protected async deliver(to: string, email: RenderedEmail): Promise<void> {
    const { data, error } = await this.client.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // Several emails invite a reply — an account freeze, a balance
      // adjustment. Without this they go to noreply@ and vanish, which is the
      // worst possible answer to "why has my money been frozen".
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
    });

    if (error) {
      // Logged AND thrown. It used only to be logged, which meant the
      // try/catch at every call site was decorative: no caller could tell a
      // sent email from one Resend rejected. Callers already swallow this —
      // they must, since they run behind money that has already moved — but
      // now they swallow something real and can log it in context.
      logger.error({ to, subject: email.subject, error }, 'Failed to send email');
      throw new Error(`Email rejected by provider: ${error.message ?? 'unknown'}`);
    }

    // The provider's id, so a "did you email me?" question is answerable.
    logger.info({ to, subject: email.subject, messageId: data?.id }, 'Email sent');
  }
}

export const emailService: EmailService = env.RESEND_API_KEY
  ? new ResendEmailService(env.RESEND_API_KEY)
  : new ConsoleEmailService();

if (!env.RESEND_API_KEY) {
  logger.warn('RESEND_API_KEY is empty — using the console email driver.');
}

if (isProduction && !env.EMAIL_REPLY_TO) {
  logger.warn(
    'EMAIL_REPLY_TO is not set — emails inviting a reply will send people to noreply@.',
  );
}
