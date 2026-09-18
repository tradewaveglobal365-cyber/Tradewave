import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as t from '../src/services/email/templates';
import type { RenderedEmail } from '../src/services/email/layout';

/**
 * Renders every email to a file so they can be LOOKED at.
 *
 * Design is the point of this work and no passing test verifies it. This is the
 * equivalent of opening the generated PDFs — the only way to catch a paragraph
 * running off the edge, a figure in the wrong green, or a preheader that reads
 * badly in an inbox list.
 *
 * Writes files. Sends nothing. The local .env holds a live Resend key, so a
 * preview that "helpfully" sent itself would email a real person.
 *
 *   npx tsx scripts/preview-emails.ts <output-dir>
 */

const out = process.argv[2] ?? join(process.cwd(), 'email-preview');
mkdirSync(out, { recursive: true });

const APP = 'https://tradewave.example';
const NAME = 'Joshua';

/** Deliberately awkward values: an apostrophe and a tag, to prove escaping. */
const PROPERTY = "O'Brien <Marina> Tower";

const samples: { group: string; name: string; email: RenderedEmail }[] = [
  // ── Account ───────────────────────────────────────────────────────────────
  { group: 'Account', name: 'Verify your email', email: t.verificationTemplate(NAME, `${APP}/verify-email?token=abc123`) },
  { group: 'Account', name: 'Welcome', email: t.welcomeTemplate(NAME, `${APP}/verify-identity`) },
  { group: 'Account', name: 'Password reset', email: t.passwordResetTemplate(NAME, `${APP}/reset-password?token=abc123`) },
  { group: 'Account', name: 'Duplicate signup', email: t.duplicateSignupTemplate(NAME, `${APP}/login`, `${APP}/forgot-password`) },
  { group: 'Account', name: 'Password changed', email: t.passwordChangedTemplate(NAME, 2, `${APP}/forgot-password`) },
  { group: 'Account', name: 'New device sign-in', email: t.newDeviceSignInTemplate({ firstName: NAME, device: 'Chrome on Windows', when: '18 September 2026, 09:14 UTC', resetUrl: `${APP}/forgot-password` }) },
  { group: 'Account', name: 'Account locked', email: t.accountLockedTemplate(NAME, 15, `${APP}/forgot-password`) },
  { group: 'Account', name: 'Suspended', email: t.accountStatusChangedTemplate(NAME, 'SUSPENDED', 'Suspected account takeover, reported by you', `${APP}/dashboard`) },
  { group: 'Account', name: 'Restricted', email: t.accountStatusChangedTemplate(NAME, 'RESTRICTED', 'A payment is being disputed by the bank', `${APP}/dashboard`) },
  { group: 'Account', name: 'Reinstated', email: t.accountStatusChangedTemplate(NAME, 'ACTIVE', 'Dispute resolved in your favour', `${APP}/dashboard`) },

  // ── Identity ──────────────────────────────────────────────────────────────
  { group: 'Identity', name: 'Verified', email: t.kycDecidedTemplate(NAME, true, `${APP}/dashboard`) },
  { group: 'Identity', name: 'Verified, name adopted', email: t.kycDecidedTemplate(NAME, true, `${APP}/dashboard`, undefined, 'Joshua Emmanuel Okoghie') },
  { group: 'Identity', name: 'Not verified', email: t.kycDecidedTemplate(NAME, false, `${APP}/verify-identity`, 'The photograph of the document was too blurred to read') },
  { group: 'Identity', name: 'In review', email: t.kycInReviewTemplate(NAME, `${APP}/verify-identity`) },
  { group: 'Identity', name: 'Re-check required', email: t.kycResetRequiredTemplate(NAME, 'Your document has expired since you verified', `${APP}/verify-identity`) },
  { group: 'Identity', name: 'Provider unavailable', email: t.kycUnavailableTemplate(NAME, `${APP}/verify-identity`) },
  { group: 'Identity', name: 'Abandoned', email: t.kycAbandonedTemplate(NAME, `${APP}/verify-identity`) },

  // ── Money in ──────────────────────────────────────────────────────────────
  { group: 'Money in', name: 'Deposit credited', email: t.depositCreditedTemplate(NAME, '₦1,650,000', '$1,000.00', '$1,250.00', `${APP}/wallet`) },
  { group: 'Money in', name: 'Deposit held', email: t.depositHeldTemplate(NAME, '₦1,650,000', `${APP}/wallet`) },

  // ── Investing ─────────────────────────────────────────────────────────────
  { group: 'Investing', name: 'Investment confirmed', email: t.investmentConfirmedTemplate(NAME, PROPERTY, '$5,000.00', '9.00%', 24, '15 January 2028', `${APP}/portfolio`) },
  { group: 'Investing', name: 'Maturity approaching', email: t.maturityApproachingTemplate({ firstName: NAME, propertyTitle: PROPERTY, payout: '$5,900.00', maturesOn: '15 January 2028', days: 7, url: `${APP}/portfolio` }) },
  { group: 'Investing', name: 'Investment matured', email: t.investmentMaturedTemplate(NAME, PROPERTY, '$5,000.00', '$900.00', '$5,900.00', `${APP}/wallet`) },

  // ── Money out ─────────────────────────────────────────────────────────────
  { group: 'Money out', name: 'Payout account changed', email: t.payoutAccountChangedTemplate(NAME, 'Access Bank', '••••0032', 'OKOGHIE JOSHUA', `${APP}/settings/payout-account`) },
  { group: 'Money out', name: 'Withdrawal requested', email: t.withdrawalRequestedTemplate(NAME, '$500.00', '$1.00', 'Access Bank', '••••0032', `${APP}/wallet`) },
  { group: 'Money out', name: 'Withdrawal approved', email: t.withdrawalApprovedTemplate({ firstName: NAME, amount: '$500.00', naira: '₦823,350', rate: '₦1,650 per $1', bankName: 'Access Bank', accountNumberMasked: '••••0032', url: `${APP}/wallet` }) },
  { group: 'Money out', name: 'Withdrawal paid', email: t.withdrawalSettledTemplate({ firstName: NAME, paid: true, amount: '$500.00', naira: '₦823,350', rate: '₦1,650 per $1', bankName: 'Access Bank', accountNumberMasked: '••••0032', url: `${APP}/wallet` }) },
  { group: 'Money out', name: 'Withdrawal failed', email: t.withdrawalSettledTemplate({ firstName: NAME, paid: false, amount: '$500.00', bankName: 'Access Bank', accountNumberMasked: '••••0032', reason: 'The receiving account is closed', url: `${APP}/wallet` }) },
  { group: 'Money out', name: 'Withdrawals blocked', email: t.withdrawalsBlockedTemplate(NAME, true, 'A payment into your account is being disputed', `${APP}/wallet`) },
  { group: 'Money out', name: 'Withdrawals unblocked', email: t.withdrawalsBlockedTemplate(NAME, false, 'Dispute resolved', `${APP}/wallet`) },
  { group: 'Money out', name: 'Withdrawals paused', email: t.withdrawalsPausedTemplate(NAME, 'Our payment provider is having an outage', `${APP}/wallet`) },
  { group: 'Money out', name: 'Balance credited', email: t.balanceAdjustedTemplate({ firstName: NAME, credit: true, amount: '$25.00', newBalance: '$1,275.00', reason: 'Goodwill credit for the failed transfer on 3 September', url: `${APP}/wallet` }) },
  { group: 'Money out', name: 'Balance debited', email: t.balanceAdjustedTemplate({ firstName: NAME, credit: false, amount: '$25.00', newBalance: '$1,225.00', reason: 'Reversing a deposit credited twice', url: `${APP}/wallet` }) },

  // ── Referrals and statements ──────────────────────────────────────────────
  { group: 'Referrals', name: 'Someone joined', email: t.referralSignupTemplate(NAME, 'Ada I.', '1%', `${APP}/referrals`) },
  { group: 'Referrals', name: 'Bonus earned', email: t.referralBonusTemplate(NAME, 'Ada I.', '$20.00', '1%', `${APP}/referrals`) },
  { group: 'Statements', name: 'Monthly statement', email: t.monthlyStatementTemplate({ firstName: NAME, period: 'August 2026', openingBalance: '$1,000.00', closingBalance: '$1,275.00', invested: '$5,000.00', earned: '$275.00', url: `${APP}/documents` }) },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

for (const sample of samples) {
  writeFileSync(join(out, `${slug(sample.group)}--${slug(sample.name)}.html`), sample.email.html);
}

// ── A single contact sheet, so the whole set can be reviewed in one scroll ───

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const groups = [...new Set(samples.map((s) => s.group))];

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tradewave emails</title>
<style>
  body{margin:0;background:#F2F0EA;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0E1512;}
  header{background:#0B3D2E;color:#fff;padding:28px 24px;}
  header h1{margin:0;font-size:22px;letter-spacing:-0.02em;}
  header p{margin:6px 0 0;color:#BCDECF;font-size:13px;}
  h2{margin:36px 24px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5C6660;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:20px;padding:16px 24px 0;}
  .card{background:#fff;border:1px solid #E5E2DA;border-radius:12px;overflow:hidden;}
  .meta{padding:12px 14px;border-bottom:1px solid #E5E2DA;}
  .meta strong{display:block;font-size:13px;}
  .meta span{display:block;margin-top:3px;font-size:12px;color:#5C6660;}
  .pre{margin-top:6px;font-size:11px;color:#A98A32;}
  iframe{display:block;width:100%;height:560px;border:0;background:#FBFAF7;}
  footer{padding:32px 24px;color:#5C6660;font-size:12px;}
</style></head><body>
<header>
  <h1>Tradewave emails</h1>
  <p>${samples.length} templates &middot; rendered from the real code &middot; nothing was sent</p>
</header>
${groups
  .map(
    (group) => `<h2>${escape(group)}</h2><div class="grid">${samples
      .filter((s) => s.group === group)
      .map(
        (s) => `<div class="card">
          <div class="meta">
            <strong>${escape(s.name)}</strong>
            <span>Subject: ${escape(s.email.subject)}</span>
            <div class="pre">Inbox preview: ${escape(
              /display:none[^>]*>([^&<]*)/.exec(s.email.html)?.[1]?.slice(0, 90) ?? '',
            )}</div>
          </div>
          <iframe srcdoc="${escape(s.email.html)}" loading="lazy"></iframe>
        </div>`,
      )
      .join('')}</div>`,
  )
  .join('')}
<footer>Each frame is the real HTML an investor receives. Plain-text parts are rendered from the same blocks.</footer>
</body></html>`;

writeFileSync(join(out, 'index.html'), index);
console.log(`${samples.length} emails written to ${out}`);
