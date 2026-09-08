import { env, isProduction } from '../../config/env';
import { logger } from '../../lib/logger';
import { DiditKycProvider } from './didit';
import type {
  KycDecision,
  KycProvider,
  StartVerificationInput,
  StartVerificationResult,
} from './types';

export type { KycProvider, KycDecision } from './types';

/**
 * Stand-in driver used until a provider contract exists.
 *
 * Outside production it approves immediately, so the whole flow — submit, gate
 * lifts, invest — is demoable end to end with no vendor account. In production it
 * returns PENDING and never decides: nothing may be marked VERIFIED on the
 * strength of a stub, least of all on a deployment a client is watching.
 */
class StubKycProvider implements KycProvider {
  readonly name = 'stub';

  async startVerification({
    reference,
  }: StartVerificationInput): Promise<StartVerificationResult> {
    if (isProduction) {
      logger.warn(
        { reference },
        'KYC submitted with the stub driver — left PENDING, no provider configured',
      );
      return { providerRef: null, redirectUrl: null, status: 'PENDING' };
    }
    // A synthetic document number, deterministic per attempt, so the duplicate
    // check in kyc.service has something real to hash in development.
    return {
      providerRef: null,
      redirectUrl: null,
      status: 'VERIFIED',
      documentNumber: `STUB-${reference.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      documentType: 'NATIONAL_ID',
    };
  }


  /** No remote side, so nothing can legitimately call back. */
  parseWebhook(): KycDecision | null {
    return null;
  }

  async getVerification(): Promise<KycDecision | null> {
    return null;
  }
}

/**
 * Typed as the interface rather than the class, so tests can vi.spyOn this
 * singleton the way auth.test.ts does with emailService.
 *
 * env.ts guarantees the three Didit vars are all set or all empty, so this one
 * check is enough to decide.
 */
export const kycProvider: KycProvider = env.DIDIT_API_KEY
  ? new DiditKycProvider(
      env.DIDIT_API_KEY,
      env.DIDIT_WORKFLOW_ID,
      env.DIDIT_WEBHOOK_SECRET,
    )
  : new StubKycProvider();

if (isProduction && !env.DIDIT_API_KEY) {
  logger.warn(
    'No KYC provider configured — identity submissions will queue as PENDING and nobody can approve them yet.',
  );
}
