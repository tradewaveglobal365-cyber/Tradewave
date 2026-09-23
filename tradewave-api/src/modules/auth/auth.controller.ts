import type { Request, Response } from 'express';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from '../../lib/cookies';
import { accountSuspended, unauthorized } from '../../lib/errors';
import {
  revokeAllSessions,
  revokeSession,
  revokeSessionByToken,
  rotateRefreshToken,
  signAccessToken,
} from '../../services/token.service';
import * as authService from './auth.service';
import { isNameEditable, toPublicUser } from './auth.service';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  UpdateProfileInput,
  ChangePasswordInput,
} from './schemas';

function sessionContext(req: Request) {
  return {
    userAgent: req.get('user-agent') ?? undefined,
    ipAddress: req.ip ?? undefined,
  };
}

export async function register(req: Request, res: Response): Promise<void> {
  await authService.register(req.body as RegisterInput);
  // Identical response whether or not the address was already registered.
  res.status(201).json({
    message: 'Account created. Check your email for a verification link.',
  });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { token } = req.body as { token: string };
  const result = await authService.verifyEmail(token, sessionContext(req));
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({
    user: toPublicUser(result.user, await isNameEditable(result.user.id, result.user.kycStatus)),
  });
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  await authService.resendVerification((req.body as ResendVerificationInput).email);
  res.json({ message: 'If that account needs verification, a new link is on its way.' });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput, sessionContext(req));
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({
    user: toPublicUser(result.user, await isNameEditable(result.user.id, result.user.kycStatus)),
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw !== 'string' || !raw) throw unauthorized('No active session.');

  const { session, rawRefreshToken, user } = await rotateRefreshToken(raw, sessionContext(req));

  // A suspended account must not be able to renew its own session. The web
  // proxy calls this automatically whenever an access token is within 60s of
  // expiring, so without this check a suspended session quietly renewed itself
  // forever and the suspension never took effect at all.
  //
  // RESTRICTED deliberately passes: that state is allowed to stay signed in and
  // read. It is requireActive that stops it moving money.
  if (user.status === 'SUSPENDED') {
    clearAuthCookies(res);
    throw accountSuspended();
  }

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    status: user.status,
    sid: session.id,
  });
  setAuthCookies(res, accessToken, rawRefreshToken);
  res.json({ user: toPublicUser(user, await isNameEditable(user.id, user.kycStatus)) });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw === 'string' && raw) await revokeSessionByToken(raw);
  else if (req.auth) await revokeSession(req.auth.sessionId);

  clearAuthCookies(res);
  res.json({ message: 'Signed out.' });
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw unauthorized();
  const count = await revokeAllSessions(req.auth.userId);
  clearAuthCookies(res);
  res.json({ message: `Signed out of ${count} session${count === 1 ? '' : 's'}.` });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw unauthorized();
  const { currentPassword, password } = req.body as ChangePasswordInput;

  const { otherSessionsEnded } = await authService.changePassword({
    userId: req.auth.userId,
    // This session is deliberately kept — see auth.service.changePassword.
    sessionId: req.auth.sessionId,
    currentPassword,
    newPassword: password,
  });

  res.json({
    message: 'Your password has been changed.',
    otherSessionsEnded,
  });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  await authService.forgotPassword((req.body as ForgotPasswordInput).identifier);
  // Always 200, always the same message.
  res.json({
    message: 'If an account exists for that email, a reset link has been sent.',
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as ResetPasswordInput;
  await authService.resetPassword(token, password);
  clearAuthCookies(res);
  res.json({ message: 'Password updated. You can now sign in.' });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw unauthorized();
  const user = await authService.getUserById(req.auth.userId);
  res.json({ user: toPublicUser(user, await isNameEditable(user.id, user.kycStatus)) });
}

/**
 * Profile edits from the settings page.
 *
 * Returns the whole user rather than just what changed, so the client replaces
 * its copy instead of merging — a partial merge is how a stale field survives
 * an edit and reappears later.
 */
export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw unauthorized();
  const input = req.body as UpdateProfileInput;
  res.json({ user: await authService.updateProfile(req.auth.userId, input) });
}
