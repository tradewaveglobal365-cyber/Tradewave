import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { DiditKycProvider } from '../services/kyc/didit';
import { applyDecision } from '../modules/kyc/kyc.service';
import { migrateTestDatabase, resetDatabase } from './helpers';

const SECRET = 'test-webhook-secret';
const provider = new DiditKycProvider('key', 'workflow', SECRET);

beforeAll(() => migrateTestDatabase());
afterAll(async () => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase();
  vi.restoreAllMocks();
});

/** Mirrors Didit's X-Signature-V2: sorted keys, compact separators. */
function sign(body: unknown, secret = SECRET): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v !== null && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortKeys((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return createHmac('sha256', secret)
    .update(JSON.stringify(sortKeys(body)), 'utf8')
    .digest('hex');
}

function webhook(body: Record<string, unknown>, opts: { secret?: string; skew?: number } = {}) {
  const ts = String(Math.floor(Date.now() / 1000) + (opts.skew ?? 0));
  return {
    body,
    headers: {
      'x-signature-v2': sign(body, opts.secret ?? SECRET),
      'x-timestamp': ts,
    } as Record<string, string>,
  };
}

const APPROVED = {
  session_id: 'sess-1',
  vendor_data: 'ref-1',
  status: 'Approved',
  liveness_checks: [{ status: 'Approved', score: 91.5 }],
  face_matches: [{ status: 'Approved', score: 88.25 }],
};

describe('Didit webhook signatures', () => {
  it('accepts a correctly signed payload', () => {
    const { body, headers } = webhook(APPROVED);
    const decision = provider.parseWebhook(body, headers);
    expect(decision?.status).toBe('VERIFIED');
    expect(decision?.reference).toBe('ref-1');
    expect(decision?.livenessScore).toBe(91.5);
    expect(decision?.faceMatchScore).toBe(88.25);
  });

  it('is insensitive to key order — the point of signing canonical JSON', () => {
    const { headers } = webhook(APPROVED);
    // Same fields, different insertion order. Raw-byte signing would fail here,
    // which is exactly why app.ts needs no express.raw() reordering.
    const reordered = {
      face_matches: APPROVED.face_matches,
      status: APPROVED.status,
      liveness_checks: APPROVED.liveness_checks,
      vendor_data: APPROVED.vendor_data,
      session_id: APPROVED.session_id,
    };
    expect(provider.parseWebhook(reordered, headers)?.status).toBe('VERIFIED');
  });

  it('rejects a tampered body, a wrong secret, a stale timestamp and missing headers', () => {
    const { body, headers } = webhook(APPROVED);

    expect(provider.parseWebhook({ ...body, status: 'Declined' }, headers)).toBeNull();

    const wrongSecret = webhook(APPROVED, { secret: 'not-the-secret' });
    expect(provider.parseWebhook(wrongSecret.body, wrongSecret.headers)).toBeNull();

    const stale = webhook(APPROVED, { skew: -400 });
    expect(provider.parseWebhook(stale.body, stale.headers)).toBeNull();

    expect(provider.parseWebhook(body, {})).toBeNull();
  });
});

describe('Didit status mapping', () => {
  const cases: [string, string | null][] = [
    ['Approved', 'VERIFIED'],
    ['Declined', 'REJECTED'],
    ['In Review', 'PENDING'],
    ['Not Started', 'PENDING'],
    ['In Progress', 'PENDING'],
    ['Awaiting User', 'PENDING'],
    ['Resubmitted', 'PENDING'],
    // Never finished — must not read as a failed check or burn a retry.
    ['Expired', 'EXPIRED'],
    ['Abandoned', 'EXPIRED'],
    ['Kyc Expired', 'EXPIRED'],
    ['Something New', null],
  ];

  it.each(cases)('maps %s to %s', (diditStatus, expected) => {
    const payload = { session_id: 's', vendor_data: 'r', status: diditStatus };
    const { body, headers } = webhook(payload);
    expect(provider.parseWebhook(body, headers)?.status ?? null).toBe(expected);
  });

  it('carries a reason through on decline', () => {
    const payload = {
      session_id: 's',
      vendor_data: 'r',
      status: 'Declined',
      id_verifications: [
        { status: 'Declined', warnings: [{ short_description: 'Name does not match' }] },
      ],
    };
    const { body, headers } = webhook(payload);
    expect(provider.parseWebhook(body, headers)?.rejectionReason).toBe(
      'Name does not match',
    );
  });
});

describe('applying decisions', () => {
  async function seedPendingAttempt() {
    const user = await prisma.user.create({
      data: {
        email: `d${Date.now()}@example.com`,
        passwordHash: 'x',
        firstName: 'A',
        lastName: 'B',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        kycStatus: 'PENDING',
      },
    });
    const attempt = await prisma.kycVerification.create({
      data: {
        userId: user.id,
        provider: 'didit',
        providerRef: 'sess-1',
        documentType: 'NIN',
        documentLast4: '8901',
        documentHash: 'h',
        status: 'PENDING',
      },
    });
    return { user, attempt };
  }

  it('applies once when the same webhook is replayed', async () => {
    const { user, attempt } = await seedPendingAttempt();
    const decision = {
      reference: attempt.id,
      providerRef: 'sess-1',
      status: 'VERIFIED' as const,
    };

    await applyDecision(decision);
    const first = await prisma.kycVerification.findUniqueOrThrow({
      where: { id: attempt.id },
    });

    await applyDecision(decision);
    const second = await prisma.kycVerification.findUniqueOrThrow({
      where: { id: attempt.id },
    });

    expect(second.decidedAt).toEqual(first.decidedAt);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).kycStatus,
    ).toBe('VERIFIED');
  });

  it('never lets a late decline un-verify someone', async () => {
    const { user, attempt } = await seedPendingAttempt();
    await applyDecision({
      reference: attempt.id,
      providerRef: 'sess-1',
      status: 'VERIFIED',
    });

    const stale = await prisma.kycVerification.create({
      data: {
        userId: user.id,
        provider: 'didit',
        providerRef: 'sess-old',
        documentType: 'NIN',
        documentLast4: '0000',
        documentHash: 'h2',
        status: 'PENDING',
      },
    });
    await applyDecision({
      reference: stale.id,
      providerRef: 'sess-old',
      status: 'REJECTED',
    });

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).kycStatus,
    ).toBe('VERIFIED');
  });

  it('ignores an unknown reference without throwing', async () => {
    await expect(
      applyDecision({
        reference: '11111111-2222-3333-4444-555555555555',
        providerRef: 'x',
        status: 'VERIFIED',
      }),
    ).resolves.toBeUndefined();
  });
});
