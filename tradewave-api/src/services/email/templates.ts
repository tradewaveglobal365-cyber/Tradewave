/**
 * Plain template strings rather than React Email: the API is a CommonJS Express
 * service, and pulling a React renderer into it to produce two transactional
 * emails is not a trade worth making. Swap to @react-email/components here if
 * the template count grows.
 */
import { env } from '../../config/env';

const BRAND = '#0B3D2E';
const BUTTON = '#12664B';

// The site the recipient actually signed up on. Derived from WEB_ORIGIN rather
// than written into the markup so the footer can never claim a domain this
// deployment doesn't serve.
const SITE_HOST = new URL(env.WEB_ORIGIN).host;

function shell(heading: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#FBFAF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBFAF7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E5E2DA;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:24px 32px;">
          <span style="color:#FFFFFF;font-size:20px;font-weight:600;letter-spacing:-0.02em;">Tradewave</span>
          <div style="height:2px;width:36px;background:#C8A94A;margin-top:10px;"></div>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0E1512;font-weight:600;">${heading}</h1>
          <div style="font-size:15px;line-height:1.6;color:#5C6660;">${body}</div>
          ${
            cta
              ? `<div style="margin:28px 0 8px;">
                   <a href="${cta.url}" style="display:inline-block;background:${BUTTON};color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">${cta.label}</a>
                 </div>
                 <p style="font-size:13px;line-height:1.6;color:#5C6660;margin:16px 0 0;">
                   If the button doesn't work, paste this into your browser:<br>
                   <span style="color:#12664B;word-break:break-all;">${cta.url}</span>
                 </p>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #E5E2DA;font-size:12px;color:#5C6660;">
          Tradewave &middot; Real estate investment<br>
          You received this because someone used this address on ${SITE_HOST}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function verificationTemplate(firstName: string, verifyUrl: string) {
  return {
    subject: 'Verify your Tradewave account',
    html: shell(
      `Welcome, ${escapeHtml(firstName)}`,
      `<p style="margin:0;">Confirm this email address to activate your Tradewave account. This link expires in 24 hours and can only be used once.</p>`,
      { label: 'Verify my account', url: verifyUrl },
    ),
    text: `Welcome to Tradewave, ${firstName}.\n\nVerify your account: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  };
}

export function passwordResetTemplate(firstName: string, resetUrl: string) {
  return {
    subject: 'Reset your Tradewave password',
    html: shell(
      'Reset your password',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, we received a request to reset your password. This link expires in 1 hour.</p>
       <p style="margin:12px 0 0;">If you didn't ask for this, you can ignore this email — your password will not change.</p>`,
      { label: 'Reset password', url: resetUrl },
    ),
    text: `Reset your Tradewave password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
  };
}

export function duplicateSignupTemplate(firstName: string, loginUrl: string, resetUrl: string) {
  return {
    subject: 'Someone tried to sign up with your email',
    html: shell(
      'You already have an account',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, someone just tried to create a Tradewave account with this email address. You already have one, so we did not create a duplicate.</p>
       <p style="margin:12px 0 0;">If that was you, just sign in. If you've forgotten your password, <a href="${resetUrl}" style="color:#12664B;">reset it here</a>.</p>`,
      { label: 'Sign in', url: loginUrl },
    ),
    text: `Someone tried to sign up with this email. You already have a Tradewave account.\n\nSign in: ${loginUrl}\nReset password: ${resetUrl}`,
  };
}

/** A labelled figure table, used by the emails that report on money. */
function rows(pairs: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;border:1px solid #E5E2DA;border-radius:8px;overflow:hidden;">
    ${pairs
      .map(
        ([label, value], i) => `<tr style="${i > 0 ? 'border-top:1px solid #E5E2DA;' : ''}">
          <td style="padding:10px 14px;font-size:13px;color:#5C6660;">${escapeHtml(label)}</td>
          <td align="right" style="padding:10px 14px;font-size:14px;font-weight:600;color:#0E1512;">${escapeHtml(value)}</td>
        </tr>`,
      )
      .join('')}
  </table>`;
}

export function kycDecidedTemplate(
  firstName: string,
  approved: boolean,
  url: string,
  reason?: string,
  adoptedName?: string,
) {
  if (approved) {
    return {
      subject: 'Your identity is verified',
      html: shell(
        `You're verified, ${escapeHtml(firstName)}`,
        `<p style="margin:0;">Your identity check has been approved. You can now fund your wallet and invest.</p>
         ${
           adoptedName
             ? `<p style="margin:12px 0 0;">We've set your name to <strong style="color:#0E1512;">${escapeHtml(adoptedName)}</strong> to match the document you verified with. Payouts can only be sent to a bank account in that name, so it needs to be the one your bank holds.</p>`
             : ''
         }`,
        { label: 'Go to your dashboard', url },
      ),
      text: approvedText(firstName, url, adoptedName),
    };
  }

  return {
    subject: 'We could not verify your identity',
    html: shell(
      'Your identity check did not pass',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, we could not verify the document you submitted.</p>
       ${reason ? `<p style="margin:12px 0 0;color:#0E1512;">${escapeHtml(reason)}</p>` : ''}
       <p style="margin:12px 0 0;">You can try again with a clearer photograph, or a different document. Make sure the whole document is in frame, in focus, and not expired.</p>`,
      { label: 'Try again', url },
    ),
    text: `Hi ${firstName}, we could not verify your identity.${reason ? `\n\n${reason}` : ''}\n\nTry again: ${url}`,
  };
}

function approvedText(firstName: string, url: string, adoptedName?: string): string {
  const name = adoptedName
    ? `\n\nWe've set your name to ${adoptedName} to match the document you verified with. Payouts can only be sent to a bank account in that name.`
    : '';
  return `You're verified, ${firstName}. You can now fund your wallet and invest.${name}\n\n${url}`;
}

export function depositCreditedTemplate(
  firstName: string,
  amountReceived: string,
  amountCredited: string,
  newBalance: string,
  url: string,
) {
  return {
    subject: `${amountCredited} added to your wallet`,
    html: shell(
      'Your deposit has landed',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, we received your transfer and converted it at the published rate.</p>
       ${rows([
         ['Received', amountReceived],
         ['Credited', amountCredited],
         ['Wallet balance', newBalance],
       ])}`,
      { label: 'View your wallet', url },
    ),
    text: `Hi ${firstName}, your deposit has landed.\n\nReceived: ${amountReceived}\nCredited: ${amountCredited}\nWallet balance: ${newBalance}\n\n${url}`,
  };
}

export function investmentConfirmedTemplate(
  firstName: string,
  propertyTitle: string,
  amount: string,
  annualReturn: string,
  termMonths: number,
  maturesOn: string,
  url: string,
) {
  return {
    subject: `You've invested ${amount} in ${propertyTitle}`,
    html: shell(
      'Your investment is confirmed',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, here are the terms, fixed at the moment you invested. Later changes to the listing do not affect them.</p>
       ${rows([
         ['Property', propertyTitle],
         ['Amount', amount],
         ['Annual return', annualReturn],
         ['Term', `${termMonths} months`],
         ['Matures', maturesOn],
       ])}`,
      { label: 'View your portfolio', url },
    ),
    text: `Hi ${firstName}, your investment is confirmed.\n\nProperty: ${propertyTitle}\nAmount: ${amount}\nAnnual return: ${annualReturn}\nTerm: ${termMonths} months\nMatures: ${maturesOn}\n\n${url}`,
  };
}

export function payoutAccountChangedTemplate(
  firstName: string,
  bankName: string,
  accountNumberMasked: string,
  accountName: string,
  url: string,
) {
  return {
    subject: 'Your payout account was changed',
    html: shell(
      'Your payout account was changed',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, the bank account your Tradewave withdrawals and returns are sent to has been set to:</p>
       ${rows([
         ['Bank', bankName],
         ['Account', accountNumberMasked],
         ['Name', accountName],
       ])}
       <p style="margin:20px 0 0;color:#0E1512;"><strong>If you did not do this, contact us immediately and change your password.</strong> Someone with access to your account could redirect your money.</p>`,
      { label: 'Review your settings', url },
    ),
    text: `Hi ${firstName}, your Tradewave payout account was changed to:\n\nBank: ${bankName}\nAccount: ${accountNumberMasked}\nName: ${accountName}\n\nIf you did not do this, contact us immediately and change your password.\n\n${url}`,
  };
}

export function withdrawalRequestedTemplate(
  firstName: string,
  amount: string,
  fee: string,
  bankName: string,
  accountNumberMasked: string,
  url: string,
) {
  return {
    subject: `Withdrawal requested — ${amount}`,
    html: shell(
      'Withdrawal requested',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, we have your request to withdraw ${escapeHtml(amount)} from your Tradewave wallet. It has been taken out of your balance and is now waiting to be reviewed and sent.</p>
       ${rows([
         ['Amount', amount],
         ['Fee', fee],
         ['To', `${bankName} ${accountNumberMasked}`],
       ])}
       <p style="margin:20px 0 0;">You will get another email when the money is on its way. The naira amount is set at the rate in force when it is sent.</p>
       <p style="margin:20px 0 0;color:#0E1512;"><strong>If you did not request this, contact us immediately and change your password.</strong></p>`,
      { label: 'View your wallet', url },
    ),
    text: `Hi ${firstName}, we have your request to withdraw ${amount} from your Tradewave wallet.\n\nAmount: ${amount}\nFee: ${fee}\nTo: ${bankName} ${accountNumberMasked}\n\nYou will get another email when the money is on its way.\n\nIf you did not request this, contact us immediately and change your password.\n\n${url}`,
  };
}

export function withdrawalSettledTemplate(params: {
  firstName: string;
  paid: boolean;
  amount: string;
  bankName: string;
  accountNumberMasked: string;
  naira?: string | undefined;
  rate?: string | undefined;
  reason?: string | undefined;
  url: string;
}) {
  const { firstName, paid, amount, bankName, accountNumberMasked, naira, rate, reason, url } =
    params;

  if (paid) {
    const pairs: [string, string][] = [
      ['Withdrawn', amount],
      ['To', `${bankName} ${accountNumberMasked}`],
    ];
    if (naira) pairs.splice(1, 0, ['Sent', naira]);
    if (rate) pairs.push(['Rate', rate]);

    return {
      subject: `Your withdrawal is on its way — ${amount}`,
      html: shell(
        'Your withdrawal is on its way',
        `<p style="margin:0;">Hi ${escapeHtml(firstName)}, your withdrawal has been sent to your bank. Transfers usually arrive within minutes, though your bank can take longer.</p>
         ${rows(pairs)}`,
        { label: 'View your wallet', url },
      ),
      text: `Hi ${firstName}, your Tradewave withdrawal has been sent to your bank.\n\nWithdrawn: ${amount}${naira ? `\nSent: ${naira}` : ''}\nTo: ${bankName} ${accountNumberMasked}${rate ? `\nRate: ${rate}` : ''}\n\n${url}`,
    };
  }

  return {
    subject: 'Your withdrawal could not be completed',
    html: shell(
      'Your withdrawal could not be completed',
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, we could not complete your ${escapeHtml(amount)} withdrawal to ${escapeHtml(bankName)} ${escapeHtml(accountNumberMasked)}.</p>
       <p style="margin:20px 0 0;"><strong>The money is back in your wallet.</strong> Nothing has been lost — you can request it again once the problem below is sorted out.</p>
       ${reason ? `<p style="margin:20px 0 0;color:#5C6660;">Reason: ${escapeHtml(reason)}</p>` : ''}`,
      { label: 'View your wallet', url },
    ),
    text: `Hi ${firstName}, we could not complete your ${amount} withdrawal to ${bankName} ${accountNumberMasked}.\n\nThe money is back in your wallet. You can request it again once the problem is sorted out.${reason ? `\n\nReason: ${reason}` : ''}\n\n${url}`,
  };
}

export function referralBonusTemplate(
  firstName: string,
  inviteeName: string,
  amount: string,
  rate: string,
  url: string,
) {
  return {
    subject: `You earned ${amount}`,
    html: shell(
      `You earned ${escapeHtml(amount)}`,
      `<p style="margin:0;">Hi ${escapeHtml(firstName)}, ${escapeHtml(inviteeName)} joined Tradewave with your link and has just made their first investment.</p>
       ${rows([
         ['Your bonus', amount],
         ['Rate', `${rate} of their first investment`],
         ['From', inviteeName],
       ])}
       <p style="margin:20px 0 0;">It is already in your wallet &mdash; nothing to claim. You can invest it or withdraw it like any other balance.</p>`,
      { label: 'View your referrals', url },
    ),
    text: `Hi ${firstName}, ${inviteeName} joined Tradewave with your link and has just made their first investment.\n\nYour bonus: ${amount}\nRate: ${rate} of their first investment\n\nIt is already in your wallet — nothing to claim.\n\n${url}`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
