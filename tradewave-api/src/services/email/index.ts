import { Resend } from 'resend';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import type {
  DuplicateSignupEmail,
  EmailService,
  PasswordResetEmail,
  VerificationEmail,
} from './types';
import {
  duplicateSignupTemplate,
  passwordResetTemplate,
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
}

export const emailService: EmailService = env.RESEND_API_KEY
  ? new ResendEmailService(env.RESEND_API_KEY)
  : new ConsoleEmailService();

if (!env.RESEND_API_KEY) {
  logger.warn('RESEND_API_KEY is empty — using the console email driver.');
}
