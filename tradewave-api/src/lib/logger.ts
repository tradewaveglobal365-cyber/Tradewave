import pino from 'pino';
import { isProduction, isTest } from '../config/env';

export const logger = pino({
  level: isTest ? 'silent' : isProduction ? 'info' : 'debug',
  // Never let a password or session cookie reach the log sink.
  redact: {
    paths: [
      'req.body.password',
      'req.body.newPassword',
      'req.body.currentPassword',
      // Defensive: the KYC request body carries only a consent flag today, but
      // pino-http logs bodies outside production, so any future document field
      // must never reach stdout.
      'req.body.documentNumber',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  transport: isProduction || isTest ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
  },
});

export type Logger = typeof logger;
