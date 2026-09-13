import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { dollarsToCents } from '../src/lib/money';
import { addMonths } from '../src/modules/investment/accrual';

/**
 * DEV ONLY — demo holdings for a named account.
 *
 * Gives one user a funded wallet and a couple of back-dated investments, so the
 * portfolio UI can be built and reviewed against real data instead of guessed
 * at. Investments are dated in the past specifically so accrual has something
 * to show; a holding created today accrues nothing and the screen looks broken.
 *
 *   npm run db:seed:demo -- ada@example.com
 *
 * Refuses to run against production.
 */
const email = process.argv[2] ?? 'ada@example.com';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function monthsAgo(n: number): Date {
  return addMonths(new Date(), -n);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo must never run in production');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}. Sign up first.`);

  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    update: { balanceCents: dollarsToCents('25000') },
    create: { userId: user.id, balanceCents: dollarsToCents('25000') },
  });

  await prisma.ledgerEntry.deleteMany({ where: { walletId: wallet.id } });
  await prisma.ledgerEntry.create({
    data: {
      walletId: wallet.id,
      type: 'DEPOSIT',
      amountCents: dollarsToCents('25000'),
      balanceAfterCents: dollarsToCents('25000'),
      reference: `demo-deposit-${user.id}`,
      description: 'Demo funding',
    },
  });

  const picks = [
    { slug: 'downtown-burj-views-apartment', amount: '20000', startedMonthsAgo: 8 },
    { slug: 'dubai-marina-tower-unit', amount: '5000', startedMonthsAgo: 3 },
  ];

  await prisma.investment.deleteMany({ where: { userId: user.id } });

  for (const pick of picks) {
    const property = await prisma.property.findUnique({ where: { slug: pick.slug } });
    if (!property) {
      console.warn(`  skipped ${pick.slug} — not seeded`);
      continue;
    }

    const investedAt = monthsAgo(pick.startedMonthsAgo);
    const principalCents = dollarsToCents(pick.amount);

    await prisma.$transaction([
      prisma.investment.create({
        data: {
          userId: user.id,
          propertyId: property.id,
          principalCents,
          // Snapshot, exactly as the real invest transaction will do.
          annualReturnBps: property.annualReturnBps,
          termMonths: property.termMonths,
          investedAt,
          maturesAt: addMonths(investedAt, property.termMonths),
        },
      }),
      prisma.property.update({
        where: { id: property.id },
        data: { fundedCents: { increment: principalCents } },
      }),
    ]);

    console.log(`  invested AED ${pick.amount} in ${pick.slug} (${pick.startedMonthsAgo}mo ago)`);
  }

  console.log(`\nDemo data ready for ${email}.`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
