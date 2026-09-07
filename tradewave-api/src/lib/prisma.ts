import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env, isProduction } from '../config/env';

/**
 * Prisma 7 no longer reads the connection URL from schema.prisma — the runtime
 * client connects through a driver adapter instead.
 *
 * This uses the POOLED url (Supabase PgBouncer, 6543). Migrations use the
 * direct url and are configured separately in prisma.config.ts.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const createClient = () => new PrismaClient({ adapter, log: ['warn', 'error'] });

// tsx watch re-imports modules on every change; without this the process leaks
// a new connection pool per reload until Postgres refuses new connections.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;
