import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moved connection URLs out of schema.prisma into this file.
 *
 * `datasource.url` here is used by the CLI only (migrate, studio, introspect),
 * so it must be the DIRECT Supabase connection on port 5432 — PgBouncer on 6543
 * cannot run migrations.
 *
 * The runtime PrismaClient does NOT read this file. It connects through
 * @prisma/adapter-pg using the pooled DATABASE_URL (6543). See src/lib/prisma.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
});
