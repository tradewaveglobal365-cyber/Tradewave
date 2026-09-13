import { PropertyStatus, type Property } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { BPS_DENOMINATOR } from '../../lib/money';

export interface PublicProperty {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  addressLine: string;
  area: string;
  city: string;
  country: string;
  images: string[];
  totalValueCents: bigint;
  minInvestmentCents: bigint;
  fundedCents: bigint;
  remainingCents: bigint;
  /** 0..1 — how much of the property has been taken up. */
  fundedProgress: number;
  annualReturnBps: number;
  termMonths: number;
  status: Property['status'];
  /** Total return on a principal over the whole term, in cents. */
  projectedReturnOnMinimumCents: bigint;
  fundingClosesAt: Date | null;
}

/**
 * Total return on a principal over the whole term, using the same simple-interest
 * rule as accrual.ts. Kept here rather than duplicated in the UI so the number a
 * user is quoted before investing matches what they actually accrue after.
 */
export function projectedReturnCents(
  principalCents: bigint,
  annualReturnBps: number,
  termMonths: number,
): bigint {
  return (principalCents * BigInt(annualReturnBps) * BigInt(termMonths)) / (BPS_DENOMINATOR * 12n);
}

export function toPublicProperty(p: Property): PublicProperty {
  const remainingCents = p.totalValueCents - p.fundedCents;
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    description: p.description,
    addressLine: p.addressLine,
    area: p.area,
    city: p.city,
    country: p.country,
    images: p.images,
    totalValueCents: p.totalValueCents,
    minInvestmentCents: p.minInvestmentCents,
    fundedCents: p.fundedCents,
    remainingCents: remainingCents > 0n ? remainingCents : 0n,
    fundedProgress:
      p.totalValueCents === 0n ? 0 : Math.min(1, Number(p.fundedCents) / Number(p.totalValueCents)),
    annualReturnBps: p.annualReturnBps,
    termMonths: p.termMonths,
    status: p.status,
    projectedReturnOnMinimumCents: projectedReturnCents(
      p.minInvestmentCents,
      p.annualReturnBps,
      p.termMonths,
    ),
    fundingClosesAt: p.fundingClosesAt,
  };
}

export async function listProperties(page: number, perPage: number) {
  // Fully funded properties stay listed (as evidence of traction) but DRAFT
  // ones are never exposed.
  const where = { status: { in: [PropertyStatus.OPEN, PropertyStatus.FUNDED] } };

  const [rows, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.property.count({ where }),
  ]);

  return {
    items: rows.map(toPublicProperty),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getPropertyBySlug(slug: string): Promise<PublicProperty> {
  const property = await prisma.property.findUnique({ where: { slug } });
  // DRAFT properties are invisible to the public, not merely unlisted.
  if (!property || property.status === 'DRAFT') throw notFound('Property not found.');
  return toPublicProperty(property);
}
