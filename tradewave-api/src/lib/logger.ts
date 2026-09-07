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
      // pino-http logs request bodies outside production; without this a NIN
      // lands in stdout on the first identity submission.
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
