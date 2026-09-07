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
  totalValueFils: bigint;
  minInvestmentFils: bigint;
  fundedFils: bigint;
  remainingFils: bigint;
  /** 0..1 — how much of the property has been taken up. */
  fundedProgress: number;
  annualReturnBps: number;
  termMonths: number;
  status: Property['status'];
  /** Total return on a principal over the whole term, in fils. */
  projectedReturnOnMinimumFils: bigint;
  fundingClosesAt: Date | null;
}

/**
 * Total return on a principal over the whole term, using the same simple-interest
 * rule as accrual.ts. Kept here rather than duplicated in the UI so the number a
 * user is quoted before investing matches what they actually accrue after.
 */
export function projectedReturnFils(
  principalFils: bigint,
  annualReturnBps: number,
  termMonths: number,
): bigint {
  return (principalFils * BigInt(annualReturnBps) * BigInt(termMonths)) / (BPS_DENOMINATOR * 12n);
}

export function toPublicProperty(p: Property): PublicProperty {
  const remainingFils = p.totalValueFils - p.fundedFils;
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
    totalValueFils: p.totalValueFils,
    minInvestmentFils: p.minInvestmentFils,
    fundedFils: p.fundedFils,
    remainingFils: remainingFils > 0n ? remainingFils : 0n,
    fundedProgress:
      p.totalValueFils === 0n ? 0 : Math.min(1, Number(p.fundedFils) / Number(p.totalValueFils)),
    annualReturnBps: p.annualReturnBps,
    termMonths: p.termMonths,
    status: p.status,
    projectedReturnOnMinimumFils: projectedReturnFils(
      p.minInvestmentFils,
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
