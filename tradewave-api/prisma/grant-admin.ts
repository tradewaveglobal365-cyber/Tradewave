import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Promotes a user to ADMIN.
 *
 *   npm run admin:grant -- ada@example.com
 *   npm run admin:grant -- ada@example.com --revoke
 *
 * A script rather than an endpoint, deliberately. The first admin has to be made
 * some other way whatever we build later, and requiring database access to grant
 * privilege means there is no route for anyone to attack. When promoting through
 * the UI is worth building, it will still need this to bootstrap.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();

  if (!email) {
    throw new Error(
      'Usage: npm run admin:grant -- <email> [--revoke]\n' +
        '  e.g. npm run admin:grant -- ada@example.com',
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, lastName: true, role: true },
  });

  // Refused rather than created. A typo should not silently do nothing, and it
  // certainly should not conjure an account with elevated privilege.
  if (!user) {
    throw new Error(`No user with email ${email}. They need to sign up first.`);
  }

  const role = revoke ? 'USER' : 'ADMIN';
  if (user.role === role) {
    console.log(`\n  ${user.email} is already ${role}. Nothing to do.\n`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role } });

  console.log(`\n  ✓ ${user.firstName} ${user.lastName} <${user.email}> is now ${role}`);

  // Takes effect on their next request, in both directions. The access token
  // does carry a role, but nothing authorises against it: requireRole reads the
  // database (deliberately — a demoted admin must lose access now, not in
  // fifteen minutes), and /auth/me, which the web layout gates on, loads the
  // user fresh. So there is no sign-out to tell anyone about.
  console.log('  Effective on their next request — no sign-out needed.\n');

  if (revoke) {
    console.log(`  To grant again:  npm run admin:grant -- ${user.email}\n`);
  } else {
    console.log(`  To revoke:       npm run admin:grant -- ${user.email} --revoke\n`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
