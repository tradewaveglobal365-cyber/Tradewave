import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env, isProduction, isTest } from './config/env';
import { logger } from './lib/logger';
import { allowedOrigins, originCheck } from './middleware/origin-check';
import { globalLimiter } from './middleware/rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { bigintReplacer } from './lib/money';
import { authRouter } from './modules/auth/auth.routes';
import { propertyRouter } from './modules/property/property.routes';
import { investmentRouter, investmentActionRouter } from './modules/investment/investment.routes';
import { walletRouter } from './modules/wallet/wallet.routes';
import { referralRouter } from './modules/referral/referral.routes';
import { kycRouter } from './modules/kyc/kyc.routes';

export function createApp(): Express {
  const app = express();

  // Behind a proxy (Vercel, Render, nginx) req.ip is the proxy's address unless
  // this is set, which would make every IP-keyed rate limit a single shared
  // bucket. The numeric form trusts exactly one hop rather than any X-F-F.
  app.set('trust proxy', isProduction ? 1 : false);

  app.disable('x-powered-by');

  // JSON.stringify throws a TypeError on BigInt rather than serialising it, so
  // without this every money-bearing response 500s. Money leaves the API as a
  // STRING of fils — a JSON number would invite arithmetic on the client.
  app.set('json replacer', bigintReplacer);

  app.use(
    helmet({
      // This API serves JSON only; a CSP belongs on the Next.js app that
      // actually renders HTML.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin and non-browser clients send no Origin header.
        // Disallowed origins get `false`, not an Error: throwing here produces a
        // generic 500 instead of letting originCheck return a clean 403, and the
        // browser blocks the response either way once the headers are absent.
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true, // required for cookies; incompatible with origin '*'
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // Health checks would otherwise dominate the log volume.
        autoLogging: { ignore: (req) => req.url === '/health' },
      }),
    );
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(originCheck);
  app.use(globalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'tradewave-api', env: env.NODE_ENV });
  });

  app.use('/api/v1/properties', propertyRouter);
  app.use('/api/v1/portfolio', investmentRouter);
  app.use('/api/v1/investments', investmentActionRouter);
  app.use('/api/v1/wallet', walletRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/referrals', referralRouter);
  app.use('/api/v1/kyc', kycRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
