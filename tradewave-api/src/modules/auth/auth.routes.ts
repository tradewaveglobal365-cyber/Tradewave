import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter,
  resendVerificationLimiter,
  changePasswordLimiter,
} from '../../middleware/rate-limit';
import * as controller from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailQuerySchema,
  changePasswordSchema,
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

/**
 * Change the password while signed in.
 *
 * requireAuth only, not requireActive: somebody who has not confirmed their
 * email yet may still need to change a password they think is compromised, and
 * that is not a moment to make them jump through a hoop first.
 *
 * The limiter is keyed on the user and mounted after requireAuth, because what
 * it is really protecting is the CURRENT password field — otherwise a stolen
 * session could be used to guess the owner's password at leisure, and the login
 * limiter would never see a single attempt.
 */
authRouter.post(
  '/change-password',
  requireAuth,
  changePasswordLimiter,
  validateBody(changePasswordSchema),
  controller.changePassword,
);

authRouter.get('/me', requireAuth, controller.me);

/**
 * Edit the profile. requireAuth only, not requireActive: someone who has not
 * confirmed their email yet should still be able to correct a misspelt name.
 *
 * Whether the NAME specifically may change depends on identity-verification
 * state — see auth.service.canEditName.
 */
authRouter.patch(
  '/me',
  requireAuth,
  validateBody(updateProfileSchema),
  controller.updateProfile,
);
