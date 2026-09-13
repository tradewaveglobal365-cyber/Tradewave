import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { dollarsToCents } from '../src/lib/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EDIT THIS FILE with the client's real listings.
 *
 * Everything below is placeholder content — titles, prices, rates, photos.
 * The application reads all of it from the database, so replacing these values
 * and re-running `npm run db:seed` is the entire process. No code changes.
 *
 * Rates are BASIS POINTS: 850 = 8.50% per annum.
 * Prices are dollar strings, converted to cents — never write a float here.
 *
 * The rates below sit in the 7–11% band, which is roughly where Dubai
 * fractional-property platforms actually advertise net yields. Anything much
 * higher stops reading as real estate and starts reading as a red flag, so
 * confirm the real numbers before these go in front of investors.
 *
 * PHOTOS are generic Unsplash stock, checked only for "plausibly Dubai". None
 * of them depicts the property described. Replace every one with real listing
 * photography before this is shown to an investor.
 *
 * ⚠️  A SECOND COPY OF THIS LIST EXISTS. The public marketing homepage shows
 * these properties too, and it is prerendered at build time so it cannot read
 * the database. It carries its own copy in the web repo at
 * `tradewave-web/content/home.ts` (the `PROPERTIES` array). EDIT BOTH — the two
 * will not warn you when they disagree.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PROPERTIES = [
  {
    slug: 'downtown-burj-views-apartment',
    title: 'Burj Views Apartment',
    summary: '2-bedroom apartment with Burj Khalifa views in Downtown Dubai.',
    description:
      'A two-bedroom apartment in Downtown Dubai with direct Burj Khalifa views, ' +
      'walking distance to Dubai Mall. Freehold title, currently tenanted on a ' +
      'twelve-month contract, in the emirate’s most established prime district.',
    addressLine: 'Mohammed Bin Rashid Blvd',
    area: 'Downtown Dubai',
    city: 'Dubai',
    totalValue: '775000',
    minInvestment: '500',
    annualReturnBps: 780,
    termMonths: 24,
    images: ['https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200&q=80'],
  },
  {
    slug: 'palm-jumeirah-signature-villa',
    title: 'Palm Jumeirah Signature Villa',
    summary: '5-bedroom beachfront villa on the Palm Jumeirah fronds.',
    description:
      'A five-bedroom Signature Villa with private beach access on the Palm Jumeirah. ' +
      'Freehold, low supply, and consistently the strongest capital-appreciation ' +
      'segment in Dubai residential.',
    addressLine: 'Frond K, Palm Jumeirah',
    area: 'Palm Jumeirah',
    city: 'Dubai',
    totalValue: '5000000',
    minInvestment: '2500',
    annualReturnBps: 690,
    termMonths: 36,
    images: ['https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200&q=80'],
  },
  {
    slug: 'dubai-marina-tower-unit',
    title: 'Marina Tower Residence',
    summary: '1-bedroom high-floor unit overlooking Dubai Marina.',
    description:
      'A high-floor one-bedroom apartment overlooking Dubai Marina and JBR. ' +
      'Short-let demand in this tower is among the strongest in the city, giving ' +
      'it an unusually low vacancy profile.',
    addressLine: 'Al Marsa Street, Dubai Marina',
    area: 'Dubai Marina',
    city: 'Dubai',
    totalValue: '450000',
    minInvestment: '250',
    annualReturnBps: 920,
    termMonths: 18,
    images: ['https://images.unsplash.com/photo-1528702748617-c64d49f918af?w=1200&q=80'],
  },
  {
    slug: 'business-bay-office-floor',
    title: 'Business Bay Office Floor',
    summary: 'Full commercial floor in a Grade A Business Bay tower.',
    description:
      'A full commercial floor in a Grade A tower in Business Bay, leased to a ' +
      'single corporate tenant. Commercial yields in Dubai typically run ahead of ' +
      'residential, at the cost of longer void periods between tenants.',
    addressLine: 'Marasi Drive, Business Bay',
    area: 'Business Bay',
    city: 'Dubai',
    totalValue: '1960000',
    minInvestment: '1250',
    annualReturnBps: 1050,
    termMonths: 36,
    images: ['https://images.unsplash.com/photo-1526495124232-a04e1849168c?w=1200&q=80'],
  },
  {
    slug: 'jvc-townhouse-cluster',
    title: 'JVC Townhouse Cluster',
    summary: 'Four 3-bedroom townhouses in Jumeirah Village Circle.',
    description:
      'Four adjoining three-bedroom townhouses in Jumeirah Village Circle, a ' +
      'mid-market district with strong rental demand from families priced out of ' +
      'Dubai Hills and Arabian Ranches.',
    addressLine: 'District 12, Jumeirah Village Circle',
    area: 'Jumeirah Village Circle',
    city: 'Dubai',
    totalValue: '1470000',
    minInvestment: '750',
    annualReturnBps: 880,
    termMonths: 24,
    images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80'],
  },
  {
    slug: 'dubai-creek-harbour-residence',
    title: 'Creek Harbour Residence',
    summary: '2-bedroom waterfront apartment in Dubai Creek Harbour.',
    description:
      'A two-bedroom waterfront apartment in Dubai Creek Harbour, an Emaar ' +
      'masterplan still in build-out. An earlier-stage district, so more of the ' +
      'return depends on the masterplan completing to schedule.',
    addressLine: 'Creek Beach, Dubai Creek Harbour',
    area: 'Dubai Creek Harbour',
    city: 'Dubai',
    totalValue: '570000',
    minInvestment: '400',
    annualReturnBps: 740,
    termMonths: 30,
    images: ['https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=1200&q=80'],
  },
] as const;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const p of PROPERTIES) {
    const data = {
      title: p.title,
      summary: p.summary,
      description: p.description,
      addressLine: p.addressLine,
      area: p.area,
      city: p.city,
      images: [...p.images],
      totalValueCents: dollarsToCents(p.totalValue),
      minInvestmentCents: dollarsToCents(p.minInvestment),
      annualReturnBps: p.annualReturnBps,
      termMonths: p.termMonths,
      status: 'OPEN' as const,
    };

    // Upsert on slug so re-seeding updates content without wiping fundedCents
    // or orphaning existing investments.
    await prisma.property.upsert({
      where: { slug: p.slug },
      update: data,
      create: { slug: p.slug, ...data },
    });
    console.log(`  property  ${p.slug}`);
  }

  // No USD/NGN rate is seeded, deliberately.
  //
  // It is an operational setting, not seed data: naira floats, and a rate
  // committed to a file is stale the day after it is written. Seeding one would
  // mean a deposit could be credited at a number nobody chose. The deposit path
  // fails closed instead — no current rate, no quote and no credit — and an
  // admin sets the live rate through the API.
  //
  // For local work, `npm run db:seed:demo` writes a placeholder rate.
  const fx = await prisma.fxRate.findFirst({
    where: { baseCurrency: 'USD', quoteCurrency: 'NGN' },
    orderBy: { effectiveAt: 'desc' },
  });
  if (!fx) {
    console.log('\n  ⚠  No USD/NGN rate set. Deposits stay closed until an admin sets one.');
  }

  console.log(`\nSeeded ${PROPERTIES.length} properties.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
