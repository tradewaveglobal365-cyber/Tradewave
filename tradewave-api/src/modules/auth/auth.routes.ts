import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter,
  resendVerificationLimiter,
} from '../../middleware/rate-limit';
import * as controller from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailQuerySchema,
} from './schemas';

export const authRouter = Router();

authRouter.post(
  '/register',
  registerLimiter,
  validateBody(registerSchema),
  controller.register,
);

/**
 * POST rather than GET: the emailed link points at the WEB app, which then
 * calls this. Keeping it a POST keeps the token out of API access logs.
 */
authRouter.post('/verify-email', validateBody(verifyEmailQuerySchema), controller.verifyEmail);

authRouter.post(
  '/resend-verification',
  resendVerificationLimiter,
  validateBody(resendVerificationSchema),
  controller.resendVerification,
);

authRouter.post('/login', loginLimiter, validateBody(loginSchema), controller.login);

authRouter.post('/refresh', controller.refresh);

authRouter.post('/logout', controller.logout);
authRouter.post('/logout-all', requireAuth, controller.logoutAll);

authRouter.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validateBody(forgotPasswordSchema),
  controller.forgotPassword,
);

authRouter.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  controller.resetPassword,
);

authRouter.get('/me', requireAuth, controller.me);
