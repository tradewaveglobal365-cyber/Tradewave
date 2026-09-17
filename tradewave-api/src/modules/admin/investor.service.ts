import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { listActionsForSubject, type AdminActionView } from './audit.service';

/**
 * Who the investors are, and what each of them has done.
 *
 * Until this existed the answer lived only in Postgres: somebody could sign up,
 * verify their identity, fund a wallet and buy into a property, and nobody at
 * Tradewave could see any of it without opening a database client.
 *
 * The READS live here. The actions that change an account — suspend, restrict,
 * block withdrawals, force a re-check, adjust a balance — live in
 * account.service, with their own audit trail, because they are decisions about
 * money or access rather than a list screen.
 *
 * ── What is deliberately NOT returned ─────────────────────────────────────
 * passwordHash and KycVerification.documentHash never leave this module. The
 * hash is a keyed HMAC used to spot the same document across accounts; putting
 * it on a screen turns an internal dedupe key into something that gets copied
 * into a spreadsheet. The payout account number is masked for the same reason
 * it is masked for the investor: it is the field an attacker would change to
 * redirect money, and reading it off a screen is not part of any workflow here.
 */

export const INVESTOR_PAGE_SIZE = 25;

export interface AdminInvestorRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  role: string;
  kycStatus: string;
  emailVerified: boolean;
  balanceCents: string;
  /** Principal in ACTIVE investments. Matured money has already been returned. */
  investedCents: string;
  investmentCount: number;
  hasPayoutAccount: boolean;
  withdrawalsBlocked: boolean;
  createdAt: Date;
}

export interface AdminInvestorList {
  investors: AdminInvestorRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One page of investors, newest first, optionally filtered by name or email.
 *
 * Paged rather than a full list like listDeposits: deposits are bounded by how
 * much money has moved, and users are not. A screen that loads every row works
 * until exactly the moment the product succeeds.
 */
export async function listInvestors(params: {
  q?: string;
  page?: number;
} = {}): Promise<AdminInvestorList> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const q = params.q?.trim();

  // Postgres ILIKE via Prisma's insensitive mode. Split on whitespace so
  // "joshua okoghie" matches a first and last name held in separate columns,
  // which a single contains() against either one would miss.
  const where: Prisma.UserWhereInput = q
    ? {
        AND: q.split(/\s+/).map((term) => ({
          OR: [
            { firstName: { contains: term, mode: 'insensitive' as const } },
            { lastName: { contains: term, mode: 'insensitive' as const } },
            { email: { contains: term, mode: 'insensitive' as const } },
          ],
        })),
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * INVESTOR_PAGE_SIZE,
      take: INVESTOR_PAGE_SIZE,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        role: true,
        kycStatus: true,
        emailVerifiedAt: true,
        createdAt: true,
        wallet: { select: { balanceCents: true } },
        payoutAccount: { select: { id: true } },
        withdrawalsBlockedAt: true,
        _count: { select: { investments: true } },
      },
    }),
  ]);

  // One grouped query for the page rather than a per-user sum, which would be
  // 25 round trips to render 25 rows.
  const sums = users.length
    ? await prisma.investment.groupBy({
        by: ['userId'],
        where: { userId: { in: users.map((u) => u.id) }, status: 'ACTIVE' },
        _sum: { principalCents: true },
      })
    : [];
  const investedByUser = new Map(
    sums.map((s) => [s.userId, s._sum.principalCents ?? 0n]),
  );

  return {
    investors: users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      role: u.role,
      kycStatus: u.kycStatus,
      emailVerified: u.emailVerifiedAt !== null,
      balanceCents: (u.wallet?.balanceCents ?? 0n).toString(),
      investedCents: (investedByUser.get(u.id) ?? 0n).toString(),
      investmentCount: u._count.investments,
      hasPayoutAccount: u.payoutAccount !== null,
      withdrawalsBlocked: u.withdrawalsBlockedAt !== null,
      createdAt: u.createdAt,
    })),
    total,
    page,
    pageSize: INVESTOR_PAGE_SIZE,
  };
}

/** Last four only, matching what the investor sees on their own settings page. */
function mask(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

export interface AdminInvestorDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  country: string;
  status: string;
  role: string;
  kycStatus: string;
  emailVerified: boolean;
  kycVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;

  /** Set while withdrawals are blocked for this investor specifically. */
  withdrawalsBlockedAt: Date | null;
  /** When staff last sent them back through identity verification. */
  kycResetAt: Date | null;
  /** What staff have done to this account, newest first. */
  actions: AdminActionView[];

  referralCode: string;
  referredBy: { id: string; firstName: string; lastName: string } | null;
  referralCount: number;

  balanceCents: string;
  entries: {
    id: string;
    type: string;
    amountCents: string;
    balanceAfterCents: string;
    description: string;
    createdAt: Date;
  }[];

  investments: {
    id: string;
    propertyTitle: string;
    propertySlug: string;
    principalCents: string;
    annualReturnBps: number;
    termMonths: number;
    status: string;
    investedAt: Date;
    maturesAt: Date;
  }[];

  payoutAccount: {
    bankName: string;
    accountNumberMasked: string;
    accountName: string;
    nameResolved: boolean;
  } | null;

  /** The account we issued for them to transfer into — ours, not their bank. */
  depositAccount: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  } | null;

  kyc: {
    provider: string;
    status: string;
    documentType: string | null;
    documentLast4: string | null;
    rejectionReason: string | null;
    submittedAt: Date;
    decidedAt: Date | null;
  } | null;
}

/** How much ledger history the detail screen carries. */
const ENTRY_LIMIT = 50;

export async function getInvestor(userId: string): Promise<AdminInvestorDetail> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      country: true,
      status: true,
      role: true,
      kycStatus: true,
      emailVerifiedAt: true,
      kycVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      withdrawalsBlockedAt: true,
      kycResetAt: true,
      referralCode: true,
      referredBy: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { referrals: true } },
      wallet: {
        select: {
          balanceCents: true,
          entries: {
            orderBy: { createdAt: 'desc' },
            take: ENTRY_LIMIT,
            select: {
              id: true,
              type: true,
              amountCents: true,
              balanceAfterCents: true,
              description: true,
              createdAt: true,
            },
          },
        },
      },
      investments: {
        orderBy: { investedAt: 'desc' },
        select: {
          id: true,
          principalCents: true,
          annualReturnBps: true,
          termMonths: true,
          status: true,
          investedAt: true,
          maturesAt: true,
          property: { select: { title: true, slug: true } },
        },
      },
      payoutAccount: {
        select: {
          bankName: true,
          accountNumber: true,
          accountName: true,
          nameResolved: true,
        },
      },
      depositAccount: {
        select: { bankName: true, accountNumber: true, accountName: true },
      },
      // Latest attempt only. The full history is a KYC-review screen's job, and
      // what this page needs to answer is "where do they stand right now".
      // documentHash is not selected — see the note at the top of this file.
      kycVerifications: {
        orderBy: { submittedAt: 'desc' },
        take: 1,
        select: {
          provider: true,
          status: true,
          documentType: true,
          documentLast4: true,
          rejectionReason: true,
          submittedAt: true,
          decidedAt: true,
        },
      },
    },
  });

  if (!user) throw notFound('That investor does not exist.');

  const actions = await listActionsForSubject(userId);

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    country: user.country,
    status: user.status,
    role: user.role,
    kycStatus: user.kycStatus,
    emailVerified: user.emailVerifiedAt !== null,
    kycVerifiedAt: user.kycVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    withdrawalsBlockedAt: user.withdrawalsBlockedAt,
    kycResetAt: user.kycResetAt,
    actions,

    referralCode: user.referralCode,
    referredBy: user.referredBy,
    referralCount: user._count.referrals,

    balanceCents: (user.wallet?.balanceCents ?? 0n).toString(),
    entries: (user.wallet?.entries ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      amountCents: e.amountCents.toString(),
      balanceAfterCents: e.balanceAfterCents.toString(),
      description: e.description,
      createdAt: e.createdAt,
    })),

    investments: user.investments.map((i) => ({
      id: i.id,
      propertyTitle: i.property.title,
      propertySlug: i.property.slug,
      principalCents: i.principalCents.toString(),
      annualReturnBps: i.annualReturnBps,
      termMonths: i.termMonths,
      status: i.status,
      investedAt: i.investedAt,
      maturesAt: i.maturesAt,
    })),

    payoutAccount: user.payoutAccount
      ? {
          bankName: user.payoutAccount.bankName,
          accountNumberMasked: mask(user.payoutAccount.accountNumber),
          accountName: user.payoutAccount.accountName,
          nameResolved: user.payoutAccount.nameResolved,
        }
      : null,

    depositAccount: user.depositAccount,
    kyc: user.kycVerifications[0] ?? null,
  };
}

// ── Identity review queue ────────────────────────────────────────────────────

/**
 * Verifications the provider has escalated and nobody has actioned.
 *
 * Didit hands a document it is unsure about to a human. That human is us, and
 * nothing said so — a real investor sat in the queue for three days and we only
 * found out because he got in touch. The queue existed; there was simply no
 * window onto it.
 *
 * The decision itself is taken in the Didit console, which has the document
 * scan and the selfie. This is the window: who is waiting, since when, and a
 * link straight to the session.
 */
export interface AdminReviewRow {
  verificationId: string;
  providerRef: string | null;
  providerStatus: string | null;
  submittedAt: Date;
  /** Whole hours waiting, so the UI does not have to do date arithmetic. */
  waitingHours: number;
  livenessScore: number | null;
  faceMatchScore: number | null;
  documentType: string | null;
  user: { id: string; email: string; firstName: string; lastName: string };
}

/**
 * "In Review" specifically, not every PENDING row.
 *
 * A session the user opened and abandoned is also PENDING, and putting those in
 * front of staff would bury the ones that actually need a decision under ones
 * that need nothing at all.
 */
export async function listPendingReviews(): Promise<AdminReviewRow[]> {
  const rows = await prisma.kycVerification.findMany({
    where: { status: 'PENDING', providerStatus: 'In Review' },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      providerRef: true,
      providerStatus: true,
      submittedAt: true,
      livenessScore: true,
      faceMatchScore: true,
      documentType: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });

  const now = Date.now();
  return rows.map((r) => ({
    verificationId: r.id,
    providerRef: r.providerRef,
    providerStatus: r.providerStatus,
    submittedAt: r.submittedAt,
    waitingHours: Math.floor((now - r.submittedAt.getTime()) / (60 * 60 * 1000)),
    livenessScore: r.livenessScore,
    faceMatchScore: r.faceMatchScore,
    documentType: r.documentType,
    user: r.user,
  }));
}
