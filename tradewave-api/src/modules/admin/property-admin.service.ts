import { Prisma, type Property, type PropertyStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, notFound, validationFailed } from '../../lib/errors';
import { toPublicProperty, type PublicProperty } from '../property/property.service';

/**
 * Property management for the admin area.
 *
 * Wraps toPublicProperty() rather than writing a second projection: the admin
 * and the investor should be looking at the same numbers, and two shaping
 * functions drift the moment one of them gains a field.
 */

/** Editing these once money is in would misstate what investors were sold. */
const MONEY_FIELDS = [
  'totalValueCents',
  'minInvestmentCents',
  'annualReturnBps',
  'termMonths',
] as const;

export interface AdminProperty extends PublicProperty {
  investorCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** False once anyone has invested — the UI disables the money fields on it. */
  moneyEditable: boolean;
}

export interface PropertyInput {
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
  annualReturnBps: number;
  termMonths: number;
  fundingClosesAt: Date | null;
}

function toAdminProperty(p: Property, investorCount: number): AdminProperty {
  return {
    ...toPublicProperty(p),
    investorCount,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    moneyEditable: p.fundedCents === 0n,
  };
}

export async function listProperties(): Promise<AdminProperty[]> {
  // DRAFT first: an unpublished listing is the one waiting on a person.
  const rows = await prisma.property.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { investments: true } } },
  });
  return rows.map((p) => toAdminProperty(p, p._count.investments));
}

export async function getProperty(id: string): Promise<AdminProperty> {
  const p = await prisma.property.findUnique({
    where: { id },
    include: { _count: { select: { investments: true } } },
  });
  if (!p) throw notFound('Property not found.');
  return toAdminProperty(p, p._count.investments);
}

export async function createProperty(input: PropertyInput): Promise<AdminProperty> {
  assertSaneMoney(input.totalValueCents, input.minInvestmentCents, 0n);

  try {
    const created = await prisma.property.create({
      // Always DRAFT. Publishing is a separate, deliberate action — a listing
      // should never become visible to investors as a side effect of saving it.
      data: { ...input, status: 'DRAFT' },
    });
    logger.info({ propertyId: created.id, slug: created.slug }, 'Property created');
    return toAdminProperty(created, 0);
  } catch (err) {
    throw translateSlugCollision(err);
  }
}

export async function updateProperty(
  id: string,
  input: Partial<PropertyInput>,
): Promise<AdminProperty> {
  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) throw notFound('Property not found.');

  const funded = existing.fundedCents > 0n;

  if (funded) {
    // Rejected rather than silently dropped. A form that appears to save a new
    // yield and does not is worse than one that says it cannot.
    const attempted = MONEY_FIELDS.filter((f) => input[f] !== undefined);
    if (attempted.length > 0) {
      throw validationFailed(
        Object.fromEntries(
          attempted.map((f) => [f, 'Locked: this property already has investors.']),
        ),
      );
    }
  }

  // The slug is a URL people already have, and every property page resolves
  // through it. Changing it after publication breaks links silently.
  if (input.slug !== undefined && input.slug !== existing.slug && existing.status !== 'DRAFT') {
    throw validationFailed({
      slug: 'Locked: the address cannot change once a listing is published.',
    });
  }

  assertSaneMoney(
    input.totalValueCents ?? existing.totalValueCents,
    input.minInvestmentCents ?? existing.minInvestmentCents,
    existing.fundedCents,
  );

  try {
    const updated = await prisma.property.update({
      where: { id },
      data: input,
      include: { _count: { select: { investments: true } } },
    });
    logger.info({ propertyId: id }, 'Property updated');
    return toAdminProperty(updated, updated._count.investments);
  } catch (err) {
    throw translateSlugCollision(err);
  }
}

export type StatusAction = 'publish' | 'close' | 'unpublish';

/**
 * Moves a listing between DRAFT, OPEN and CLOSED.
 *
 * FUNDED is deliberately absent: createInvestment sets it when the last
 * allocation is taken, and keeping one writer for that state means the admin
 * cannot mark a property funded that is not.
 */
export async function setStatus(id: string, action: StatusAction): Promise<AdminProperty> {
  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) throw notFound('Property not found.');

  let status: PropertyStatus;
  switch (action) {
    case 'publish':
      if (existing.images.length === 0) {
        throw badRequest('Add at least one photograph before publishing.');
      }
      status = 'OPEN';
      break;
    case 'close':
      status = 'CLOSED';
      break;
    case 'unpublish':
      // Hiding a listing people have already funded would strand them: it would
      // vanish from browse while still sitting in their portfolio.
      if (existing.fundedCents > 0n) {
        throw badRequest('This property has investors and cannot be unpublished.');
      }
      status = 'DRAFT';
      break;
  }

  const updated = await prisma.property.update({
    where: { id },
    data: { status },
    include: { _count: { select: { investments: true } } },
  });
  logger.info({ propertyId: id, status }, 'Property status changed');
  return toAdminProperty(updated, updated._count.investments);
}

/**
 * Invariants that hold whatever the status.
 *
 * The total-below-funded check is the one that matters: a mistyped value there
 * makes remainingCents negative and the funding bar nonsense, and the money has
 * already been taken.
 */
function assertSaneMoney(total: bigint, minimum: bigint, funded: bigint): void {
  if (total <= 0n) {
    throw validationFailed({ totalValueCents: 'Give the property a value above zero.' });
  }
  if (minimum <= 0n) {
    throw validationFailed({ minInvestmentCents: 'Give a minimum above zero.' });
  }
  if (minimum > total) {
    throw validationFailed({
      minInvestmentCents: 'The minimum cannot exceed the property value.',
    });
  }
  if (total < funded) {
    throw validationFailed({
      totalValueCents: 'This is below the amount already raised for this property.',
    });
  }
}

/** P2002 on slug is a user typing a name that exists, not a server fault. */
function translateSlugCollision(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return validationFailed({ slug: 'A property already uses this address.' });
  }
  return err;
}
