/**
 * What each email says.
 *
 * Structure, colour and client quirks live in ./layout — these functions decide
 * only the words and which blocks they go in. Both the HTML and the plain-text
 * part are rendered from the same Block[], so the two cannot drift apart the
 * way they had begun to.
 *
 * ── House voice ───────────────────────────────────────────────────────────
 * Plain sentences, no exclamation marks, no emoji. Say what happened first and
 * what it means second. Where money moved, the figure is a block of its own
 * rather than a number buried in a paragraph. Anything a person might need to
 * act on urgently — money leaving, access changing — is a notice block, not
 * bold text in the middle of a sentence.
 */
import { env } from '../../config/env';
import { render, type Block, type RenderedEmail } from './layout';

/** Where emails tell people to write. Falls back to the from-address. */
const SUPPORT = env.EMAIL_REPLY_TO || env.EMAIL_FROM;

/** "reply to this email" is only honest when a reply reaches somebody. */
const replyLine = (): string =>
  env.EMAIL_REPLY_TO
    ? 'If this was not you, or anything looks wrong, reply to this email.'
    : `If this was not you, or anything looks wrong, contact us at ${SUPPORT}.`;

// ── Account ──────────────────────────────────────────────────────────────────

export function verificationTemplate(firstName: string, verifyUrl: string): RenderedEmail {
  return render({
    subject: 'Verify your Tradewave account',
    preheader: 'Confirm your email address to activate your account.',
    heading: `Welcome, ${firstName}`,
    blocks: [
      {
        kind: 'text',
        text: 'Confirm this email address to activate your Tradewave account. The link expires in 24 hours and can only be used once.',
      },
    ],
    cta: { label: 'Verify my account', url: verifyUrl },
  });
}

export function welcomeTemplate(firstName: string, url: string): RenderedEmail {
  return render({
    subject: 'Your Tradewave account is ready',
    preheader: 'Three short steps before you can invest.',
    heading: `You're in, ${firstName}`,
    blocks: [
      {
        kind: 'text',
        text: 'Your email is confirmed and your account is open. There are three things between you and your first investment, and the first one is the only slow part.',
      },
      {
        kind: 'rows',
        pairs: [
          ['1. Verify your identity', 'About a minute — an ID and a selfie'],
          ['2. Fund your wallet', 'A transfer to your own naira account'],
          ['3. Choose a property', 'From the minimum shown on each listing'],
        ],
      },
      {
        kind: 'text',
        text: 'Identity verification is required before you can add funds, so it is worth doing now rather than when you are ready to invest.',
      },
    ],
    cta: { label: 'Verify your identity', url },
  });
}

export function passwordResetTemplate(firstName: string, resetUrl: string): RenderedEmail {
  return render({
    subject: 'Reset your Tradewave password',
    preheader: 'This link expires in one hour.',
    heading: 'Reset your password',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, use the link below to set a new password. It expires in one hour and can only be used once.`,
      },
      {
        kind: 'notice',
        text: 'If you did not ask for this, you can ignore it — your password has not changed, and nobody can use this link without your inbox.',
      },
    ],
    cta: { label: 'Reset password', url: resetUrl },
  });
}

export function duplicateSignupTemplate(
  firstName: string,
  loginUrl: string,
  resetUrl: string,
): RenderedEmail {
  return render({
    subject: 'Someone tried to sign up with your email',
    preheader: 'You already have a Tradewave account.',
    heading: 'You already have an account',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, somebody just tried to create a Tradewave account with this email address. You already have one, so nothing was created and nothing has changed.`,
      },
      {
        kind: 'text',
        text: `If that was you, sign in instead. If you have forgotten your password, you can reset it: ${resetUrl}`,
      },
      { kind: 'footnote', text: replyLine() },
    ],
    cta: { label: 'Sign in', url: loginUrl },
  });
}

export function passwordChangedTemplate(
  firstName: string,
  otherSessionsEnded: number,
  resetUrl: string,
): RenderedEmail {
  const devices =
    otherSessionsEnded === 0
      ? 'No other devices were signed in.'
      : `${otherSessionsEnded} other ${otherSessionsEnded === 1 ? 'device was' : 'devices were'} signed out.`;

  return render({
    subject: 'Your Tradewave password was changed',
    preheader: devices,
    heading: 'Your password was changed',
    blocks: [
      { kind: 'text', text: `Hi ${firstName}, the password on your account has just been changed. ${devices}` },
      {
        kind: 'notice',
        text: 'If this was not you, reset your password now — whoever made this change can sign in until you do.',
      },
    ],
    cta: { label: 'Reset your password', url: resetUrl },
  });
}

export function newDeviceSignInTemplate(params: {
  firstName: string;
  device: string;
  when: string;
  resetUrl: string;
}): RenderedEmail {
  return render({
    subject: 'New sign-in to your Tradewave account',
    preheader: `Signed in from ${params.device}.`,
    heading: 'A new device signed in',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${params.firstName}, your account was signed into from a device we have not seen before.`,
      },
      { kind: 'rows', pairs: [['Device', params.device], ['When', params.when]] },
      {
        kind: 'notice',
        text: 'If this was you, nothing to do. If not, reset your password immediately — that signs out every device.',
      },
    ],
    cta: { label: 'Reset your password', url: params.resetUrl },
  });
}

export function accountLockedTemplate(
  firstName: string,
  minutes: number,
  resetUrl: string,
): RenderedEmail {
  return render({
    subject: 'Your Tradewave account is temporarily locked',
    preheader: `Too many failed sign-in attempts. It unlocks in ${minutes} minutes.`,
    heading: 'Too many failed sign-in attempts',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, somebody has tried and failed to sign into your account several times, so we have locked it for ${minutes} minutes. Your money and your holdings are untouched.`,
      },
      {
        kind: 'notice',
        text: 'If that was not you, somebody is guessing your password. Reset it now and pick something they cannot guess.',
      },
    ],
    cta: { label: 'Reset your password', url: resetUrl },
  });
}

export function accountStatusChangedTemplate(
  firstName: string,
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'RESTRICTED' | 'SUSPENDED',
  reason: string,
  url: string,
): RenderedEmail {
  const copy = {
    SUSPENDED: {
      subject: 'Your Tradewave account has been suspended',
      heading: 'Your account has been suspended',
      body: 'You will not be able to sign in while this is in place. Your balance and any investments you hold are unaffected and remain yours.',
    },
    RESTRICTED: {
      subject: 'Your Tradewave account has been restricted',
      heading: 'Your account has been restricted',
      body: 'You can still sign in and see everything — your balance, your holdings and your history are all where you left them. What you cannot do for now is move money in or out.',
    },
    ACTIVE: {
      subject: 'Your Tradewave account has been reinstated',
      heading: 'Your account has been reinstated',
      body: 'Everything is back to normal. You can sign in, invest and withdraw as before.',
    },
    PENDING_VERIFICATION: {
      subject: 'Your Tradewave account has been reinstated',
      heading: 'Your account has been reinstated',
      body: 'Everything is back to normal. Confirm your email address to finish setting the account up.',
    },
  }[status];

  return render({
    subject: copy.subject,
    preheader: reason,
    heading: copy.heading,
    blocks: [
      { kind: 'text', text: `Hi ${firstName}, ${copy.body}` },
      { kind: 'rows', pairs: [['Reason', reason]] },
      { kind: 'footnote', text: `If you think this is a mistake, ${replyLine().replace(/^If this was not you, or anything looks wrong, /, '')}` },
    ],
    cta: { label: 'Open Tradewave', url },
  });
}

// ── Identity ─────────────────────────────────────────────────────────────────

export function kycDecidedTemplate(
  firstName: string,
  approved: boolean,
  url: string,
  reason?: string,
  adoptedName?: string,
): RenderedEmail {
  if (approved) {
    const blocks: Block[] = [
      { kind: 'pill', label: 'Verified', tone: 'gain' },
      {
        kind: 'text',
        text: `You're verified, ${firstName}. You can now fund your wallet and invest.`,
      },
    ];
    if (adoptedName) {
      blocks.push({
        kind: 'text',
        text: `We have set your name to ${adoptedName} to match the document you verified with. Money can only be paid to a bank account in that name, which is why the two have to agree.`,
      });
    }
    return render({
      subject: 'Your identity is verified',
      preheader: 'You can now fund your wallet and invest.',
      heading: 'Your identity is verified',
      blocks,
      cta: { label: 'Go to your dashboard', url },
    });
  }

  return render({
    subject: 'We could not verify your identity',
    preheader: reason ?? 'You can try again.',
    heading: 'We could not verify your identity',
    blocks: [
      { kind: 'pill', label: 'Not verified', tone: 'loss' },
      {
        kind: 'text',
        text: `Hi ${firstName}, the check did not pass. You can try again — most failures are a blurred photograph or a document edge cut off.`,
      },
      ...(reason ? ([{ kind: 'rows', pairs: [['Reason', reason]] }] as Block[]) : []),
    ],
    cta: { label: 'Try again', url },
  });
}

export function kycInReviewTemplate(firstName: string, url: string): RenderedEmail {
  return render({
    subject: 'Your identity check is being reviewed',
    preheader: 'Somebody is looking at your document. No action needed.',
    heading: 'Your document is being reviewed',
    blocks: [
      { kind: 'pill', label: 'In review', tone: 'pending' },
      {
        kind: 'text',
        text: `Hi ${firstName}, your identity check needs a person to look at it rather than being decided automatically. That is normal and does not mean anything is wrong.`,
      },
      {
        kind: 'text',
        text: 'There is nothing for you to do. We will email you as soon as there is a decision, usually within a day or two.',
      },
    ],
    cta: { label: 'Check your status', url },
  });
}

export function kycResetRequiredTemplate(
  firstName: string,
  reason: string,
  url: string,
): RenderedEmail {
  return render({
    subject: 'Please verify your identity again',
    preheader: reason,
    heading: 'Please verify your identity again',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, we need you to go through identity verification once more before you can invest again.`,
      },
      { kind: 'rows', pairs: [['Reason', reason]] },
      {
        kind: 'text',
        text: 'It takes about a minute — photograph an ID and take a selfie. Your balance and any investments you hold are unaffected, and this does not count against your attempt limit.',
      },
    ],
    cta: { label: 'Verify identity', url },
  });
}

export function kycUnavailableTemplate(firstName: string, url: string): RenderedEmail {
  return render({
    subject: 'Your identity check could not be started',
    preheader: 'A problem on our side, not yours. Please try again.',
    heading: 'Something went wrong on our side',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, we could not start your identity check because our verification provider was unreachable. This is our problem, not anything to do with your documents.`,
      },
      {
        kind: 'text',
        text: 'It did not count against your attempts. Please try again in a few minutes.',
      },
    ],
    cta: { label: 'Try again', url },
  });
}

export function kycAbandonedTemplate(firstName: string, url: string): RenderedEmail {
  return render({
    subject: 'Finish verifying your identity',
    preheader: 'Your verification link is still open.',
    heading: 'You did not finish verifying',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, you started verifying your identity but did not finish. Your link is still open, so you can pick up where you left off rather than starting again.`,
      },
      {
        kind: 'text',
        text: 'You need this before you can add funds or invest.',
      },
    ],
    cta: { label: 'Finish verifying', url },
  });
}

// ── Money in ─────────────────────────────────────────────────────────────────

export function depositCreditedTemplate(
  firstName: string,
  amountReceived: string,
  amountCredited: string,
  newBalance: string,
  url: string,
): RenderedEmail {
  return render({
    subject: `${amountCredited} added to your wallet`,
    preheader: `We received ${amountReceived} and credited ${amountCredited}.`,
    heading: 'Your money has arrived',
    blocks: [
      { kind: 'figure', label: 'Added to your wallet', value: amountCredited, tone: 'gain' },
      { kind: 'text', text: `Hi ${firstName}, your transfer has landed and your wallet has been credited.` },
      {
        kind: 'rows',
        pairs: [
          ['Received', amountReceived],
          ['Credited', amountCredited],
          ['New balance', newBalance],
        ],
      },
    ],
    cta: { label: 'View your wallet', url },
  });
}

export function depositHeldTemplate(
  firstName: string,
  amountReceived: string,
  url: string,
): RenderedEmail {
  return render({
    subject: 'We have your transfer — it is being processed',
    preheader: `${amountReceived} received. It will be in your wallet shortly.`,
    heading: 'We have your transfer',
    blocks: [
      { kind: 'figure', label: 'Received', value: amountReceived },
      {
        kind: 'text',
        text: `Hi ${firstName}, your transfer has reached us safely. It is not in your wallet yet because we are waiting on today's exchange rate to be set, and we will not credit money at a rate we cannot stand behind.`,
      },
      {
        kind: 'text',
        text: 'There is nothing for you to do. It will appear in your wallet automatically, and we will email you when it does.',
      },
      { kind: 'footnote', text: replyLine() },
    ],
    cta: { label: 'View your wallet', url },
  });
}

// ── Investing ────────────────────────────────────────────────────────────────

export function investmentConfirmedTemplate(
  firstName: string,
  propertyTitle: string,
  amount: string,
  annualReturn: string,
  termMonths: number,
  maturesOn: string,
  url: string,
): RenderedEmail {
  return render({
    subject: `You have invested ${amount} in ${propertyTitle}`,
    preheader: `${annualReturn} a year, maturing ${maturesOn}.`,
    heading: 'Your investment is live',
    blocks: [
      { kind: 'figure', label: 'Invested', value: amount },
      { kind: 'text', text: `Hi ${firstName}, your stake in ${propertyTitle} is confirmed.` },
      {
        kind: 'rows',
        pairs: [
          ['Property', propertyTitle],
          ['Annual return', annualReturn],
          ['Term', `${termMonths} months`],
          ['Matures on', maturesOn],
        ],
      },
      {
        kind: 'text',
        text: 'These terms are fixed for the life of this holding. Your certificate is in your documents whenever you need it.',
      },
    ],
    cta: { label: 'View your portfolio', url },
  });
}

export function maturityApproachingTemplate(params: {
  firstName: string;
  propertyTitle: string;
  payout: string;
  maturesOn: string;
  days: number;
  url: string;
}): RenderedEmail {
  return render({
    subject: `Your investment matures in ${params.days} days`,
    preheader: `${params.payout} will be paid into your wallet on ${params.maturesOn}.`,
    heading: 'Your investment is about to mature',
    blocks: [
      { kind: 'figure', label: 'Due to you', value: params.payout, tone: 'gain' },
      {
        kind: 'text',
        text: `Hi ${params.firstName}, your investment in ${params.propertyTitle} reaches the end of its term in ${params.days} days.`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Property', params.propertyTitle],
          ['Matures on', params.maturesOn],
          ['Principal and return', params.payout],
        ],
      },
      {
        kind: 'text',
        text: 'It will be paid into your wallet automatically on the day. Nothing is required from you.',
      },
    ],
    cta: { label: 'View your portfolio', url: params.url },
  });
}

export function investmentMaturedTemplate(
  firstName: string,
  propertyTitle: string,
  principal: string,
  earned: string,
  total: string,
  url: string,
): RenderedEmail {
  return render({
    subject: `Your investment matured — ${total} is in your wallet`,
    preheader: `${principal} returned plus ${earned} earned.`,
    heading: 'Your investment matured',
    blocks: [
      { kind: 'figure', label: 'Paid into your wallet', value: total, tone: 'gain' },
      {
        kind: 'text',
        text: `Hi ${firstName}, your investment in ${propertyTitle} has reached the end of its term. Your money is back, with what it earned.`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Principal returned', principal],
          ['Return earned', earned],
          ['Total', total],
        ],
      },
      { kind: 'text', text: 'You can invest it again or withdraw it, like any other balance.' },
    ],
    cta: { label: 'View your wallet', url },
  });
}

// ── Money out ────────────────────────────────────────────────────────────────

export function payoutAccountChangedTemplate(
  firstName: string,
  bankName: string,
  accountNumberMasked: string,
  accountName: string,
  url: string,
): RenderedEmail {
  return render({
    subject: 'Your payout account was changed',
    preheader: `Withdrawals will now go to ${bankName} ${accountNumberMasked}.`,
    heading: 'Your payout account was changed',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, the bank account your withdrawals and returns are sent to has been set to:`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Bank', bankName],
          ['Account', accountNumberMasked],
          ['Name', accountName],
        ],
      },
      {
        kind: 'notice',
        text: 'If you did not do this, contact us immediately and change your password. Someone with access to your account could redirect your money.',
      },
      {
        kind: 'footnote',
        text: 'For your security, withdrawals are held for 24 hours after this changes.',
      },
    ],
    cta: { label: 'Review your settings', url },
  });
}

export function withdrawalRequestedTemplate(
  firstName: string,
  amount: string,
  fee: string,
  bankName: string,
  accountNumberMasked: string,
  url: string,
): RenderedEmail {
  return render({
    subject: `Withdrawal requested — ${amount}`,
    preheader: `Going to ${bankName} ${accountNumberMasked}.`,
    heading: 'Withdrawal requested',
    blocks: [
      { kind: 'figure', label: 'Withdrawing', value: amount },
      {
        kind: 'text',
        text: `Hi ${firstName}, we have your request. It has been taken out of your balance and is waiting to be reviewed and sent.`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Amount', amount],
          ['Fee', fee],
          ['To', `${bankName} ${accountNumberMasked}`],
        ],
      },
      {
        kind: 'text',
        text: 'You will get another email when the money is on its way. The naira amount is set at the rate in force when it is sent.',
      },
      {
        kind: 'notice',
        text: 'If you did not request this, contact us immediately and change your password.',
      },
    ],
    cta: { label: 'View your wallet', url },
  });
}

export function withdrawalApprovedTemplate(params: {
  firstName: string;
  amount: string;
  naira: string;
  rate: string;
  bankName: string;
  accountNumberMasked: string;
  url: string;
}): RenderedEmail {
  return render({
    subject: `Your withdrawal is on its way — ${params.naira}`,
    preheader: `Sent to ${params.bankName} ${params.accountNumberMasked}.`,
    heading: 'Your withdrawal has been sent',
    blocks: [
      { kind: 'figure', label: 'On its way to your bank', value: params.naira },
      {
        kind: 'text',
        text: `Hi ${params.firstName}, your withdrawal has been approved and sent. Transfers usually arrive within minutes, though your bank can take longer.`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Withdrawn', params.amount],
          ['Sent', params.naira],
          ['Rate', params.rate],
          ['To', `${params.bankName} ${params.accountNumberMasked}`],
        ],
      },
    ],
    cta: { label: 'View your wallet', url: params.url },
  });
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
}): RenderedEmail {
  const { firstName, paid, amount, bankName, accountNumberMasked, naira, rate, reason, url } =
    params;

  if (paid) {
    const pairs: [string, string][] = [['Withdrawn', amount]];
    if (naira) pairs.push(['Sent', naira]);
    if (rate) pairs.push(['Rate', rate]);
    pairs.push(['To', `${bankName} ${accountNumberMasked}`]);

    return render({
      subject: `Your withdrawal has arrived — ${amount}`,
      preheader: `Paid to ${bankName} ${accountNumberMasked}.`,
      heading: 'Your withdrawal is complete',
      blocks: [
        { kind: 'figure', label: 'Paid out', value: naira ?? amount },
        { kind: 'text', text: `Hi ${firstName}, your bank has confirmed the transfer.` },
        { kind: 'rows', pairs },
      ],
      cta: { label: 'View your wallet', url },
    });
  }

  return render({
    subject: 'Your withdrawal could not be completed',
    preheader: reason ?? 'The money is back in your wallet.',
    heading: 'Your withdrawal could not be completed',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, we could not complete your ${amount} withdrawal to ${bankName} ${accountNumberMasked}.`,
      },
      {
        kind: 'notice',
        text: 'The money is back in your wallet. Nothing has been lost — you can request it again once the problem is sorted out.',
      },
      ...(reason ? ([{ kind: 'rows', pairs: [['Reason', reason]] }] as Block[]) : []),
    ],
    cta: { label: 'View your wallet', url },
  });
}

export function withdrawalsBlockedTemplate(
  firstName: string,
  blocked: boolean,
  reason: string,
  url: string,
): RenderedEmail {
  if (!blocked) {
    return render({
      subject: 'Withdrawals are available again',
      preheader: 'You can request a withdrawal as normal.',
      heading: 'Withdrawals are available again',
      blocks: [
        {
          kind: 'text',
          text: `Hi ${firstName}, the hold on withdrawals from your account has been lifted. You can request one as normal.`,
        },
      ],
      cta: { label: 'View your wallet', url },
    });
  }

  return render({
    subject: 'Withdrawals are on hold for your account',
    preheader: reason,
    heading: 'Withdrawals are on hold',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, we have put a hold on withdrawals from your account. Your balance and any investments you hold are unaffected and remain yours — everything else on your account works as normal.`,
      },
      { kind: 'rows', pairs: [['Reason', reason]] },
      { kind: 'footnote', text: replyLine() },
    ],
    cta: { label: 'View your wallet', url },
  });
}

export function withdrawalsPausedTemplate(
  firstName: string,
  reason: string,
  url: string,
): RenderedEmail {
  return render({
    subject: 'Withdrawals are paused for now',
    preheader: reason,
    heading: 'Withdrawals are paused',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, withdrawals across Tradewave are paused for the moment. Everybody's balance and holdings are unaffected — this stops money leaving, it does not touch what is there.`,
      },
      { kind: 'rows', pairs: [['Reason', reason]] },
      { kind: 'text', text: 'We will email you as soon as they reopen.' },
      { kind: 'footnote', text: replyLine() },
    ],
    cta: { label: 'View your wallet', url },
  });
}

export function balanceAdjustedTemplate(params: {
  firstName: string;
  credit: boolean;
  amount: string;
  newBalance: string;
  reason: string;
  url: string;
}): RenderedEmail {
  const { firstName, credit, amount, newBalance, reason, url } = params;

  return render({
    subject: credit
      ? `${amount} was added to your wallet`
      : `${amount} was taken from your wallet`,
    preheader: reason,
    heading: credit ? 'Money added to your wallet' : 'Money taken from your wallet',
    blocks: [
      {
        kind: 'figure',
        label: credit ? 'Added' : 'Taken',
        value: amount,
        ...(credit ? { tone: 'gain' as const } : {}),
      },
      {
        kind: 'text',
        text: `Hi ${firstName}, ${amount} has been ${credit ? 'added to' : 'taken from'} your wallet by our team.`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Reason', reason],
          ['New balance', newBalance],
        ],
      },
      { kind: 'notice', text: `If this does not look right, ${replyLine().replace(/^If this was not you, or anything looks wrong, /, '')}` },
    ],
    cta: { label: 'View your wallet', url },
  });
}

// ── Referrals ────────────────────────────────────────────────────────────────

export function referralSignupTemplate(
  firstName: string,
  inviteeName: string,
  rate: string,
  url: string,
): RenderedEmail {
  return render({
    subject: `${inviteeName} joined with your link`,
    preheader: `You earn ${rate} of their first investment.`,
    heading: 'Somebody joined with your link',
    blocks: [
      {
        kind: 'text',
        text: `Hi ${firstName}, ${inviteeName} has created a Tradewave account using your referral link.`,
      },
      {
        kind: 'text',
        text: `You earn ${rate} of their first investment, paid into your wallet automatically the moment they make it. Nothing to claim.`,
      },
    ],
    cta: { label: 'View your referrals', url },
  });
}

export function referralBonusTemplate(
  firstName: string,
  inviteeName: string,
  amount: string,
  rate: string,
  url: string,
): RenderedEmail {
  return render({
    subject: `You earned ${amount}`,
    preheader: `${inviteeName} made their first investment.`,
    heading: `You earned ${amount}`,
    blocks: [
      { kind: 'figure', label: 'Your bonus', value: amount, tone: 'gain' },
      {
        kind: 'text',
        text: `Hi ${firstName}, ${inviteeName} joined with your link and has just made their first investment.`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Your bonus', amount],
          ['Rate', `${rate} of their first investment`],
          ['From', inviteeName],
        ],
      },
      {
        kind: 'text',
        text: 'It is already in your wallet — nothing to claim. You can invest it or withdraw it like any other balance.',
      },
    ],
    cta: { label: 'View your referrals', url },
  });
}

// ── Statements ───────────────────────────────────────────────────────────────

export function monthlyStatementTemplate(params: {
  firstName: string;
  period: string;
  openingBalance: string;
  closingBalance: string;
  invested: string;
  earned: string;
  url: string;
}): RenderedEmail {
  return render({
    subject: `Your ${params.period} statement`,
    preheader: `Closing balance ${params.closingBalance}.`,
    heading: `Your ${params.period} statement`,
    blocks: [
      { kind: 'figure', label: 'Closing balance', value: params.closingBalance },
      {
        kind: 'text',
        text: `Hi ${params.firstName}, here is where your account stood at the end of ${params.period}.`,
      },
      {
        kind: 'rows',
        pairs: [
          ['Opening balance', params.openingBalance],
          ['Closing balance', params.closingBalance],
          ['Invested', params.invested],
          ['Returns earned', params.earned],
        ],
      },
      {
        kind: 'text',
        text: 'The full statement, with every transaction, is available to download as a PDF.',
      },
    ],
    cta: { label: 'Download your statement', url: params.url },
  });
}
