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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
