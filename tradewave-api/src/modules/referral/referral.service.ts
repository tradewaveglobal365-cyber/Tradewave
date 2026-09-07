import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';

export interface ReferralSummary {
  code: string;
  shareUrl: string;
  totalReferrals: number;
  verifiedReferrals: number;
}

export interface ReferralListItem {
  displayName: string;
  maskedEmail: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  joinedAt: Date;
}

export async function getSummary(userId: string): Promise<ReferralSummary> {
  const [user, totalReferrals, verifiedReferrals] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    }),
    prisma.user.count({ where: { referredById: userId } }),
    prisma.user.count({ where: { referredById: userId, emailVerifiedAt: { not: null } } }),
  ]);

  return {
    code: user.referralCode,
    shareUrl: `${env.WEB_ORIGIN}/signup?ref=${user.referralCode}`,
    totalReferrals,
    verifiedReferrals,
  };
}

/**
 * Invitees are other people. The referrer gets enough to recognise who joined
 * and nothing more — no full email, no phone. Masking here rather than in the
 * UI means the full address never leaves the server.
 */
export async function listReferrals(userId: string, page: number, perPage: number) {
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where: { referredById: userId },
      select: { firstName: true, lastName: true, email: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.user.count({ where: { referredById: userId } }),
  ]);

  const items: ReferralListItem[] = rows.map((r) => ({
    displayName: `${r.firstName} ${r.lastName.charAt(0)}.`,
    maskedEmail: maskEmail(r.email),
    status: r.status,
    joinedAt: r.createdAt,
  }));

  return { items, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(3, local.length - head.length))}@${domain}`;
}

/**
 * Public lookup used by the signup form to render "Invited by Ada".
 * Returns only a first name — never confirms an email or exposes a user id.
 */
export async function validateCode(code: string) {
  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { firstName: true, status: true },
  });

  if (!referrer || referrer.status === 'SUSPENDED') return { valid: false as const };
  return { valid: true as const, referrerFirstName: referrer.firstName };
}
