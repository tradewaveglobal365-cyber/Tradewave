/**
 * Points every test at a throwaway database BEFORE any module reads env.
 * config/env.ts parses process.env at import time, so this must run first —
 * which is why it is a setupFile rather than an import inside a test.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgresql://bigdreams@localhost:5432/tradewave_test';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.RESEND_API_KEY = '';
process.env.EMAIL_FROM = 'Tradewave <noreply@test.invalid>';
process.env.COOKIE_DOMAIN = '';
process.env.KYC_PROVIDER_API_KEY = '';
process.env.KYC_ID_PEPPER = 'test-pepper-that-is-long-enough-32-chars';
process.env.DIDIT_API_KEY = '';
process.env.DIDIT_WORKFLOW_ID = '';
process.env.DIDIT_WEBHOOK_SECRET = '';
