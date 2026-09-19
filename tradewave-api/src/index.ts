import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startScheduler, stopScheduler } from './services/scheduler';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`tradewave-api listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  // After listening, not before: a job claiming a lock is not a reason for the
  // port to be late, and a boot that fails should fail on the server.
  startScheduler();
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  // Stop taking new job slots first. A job already running keeps its lease and
  // releases it or lets it expire — which is exactly what the lease is for.
  stopScheduler();
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
