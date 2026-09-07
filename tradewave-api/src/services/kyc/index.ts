import { env, isProduction } from '../../config/env';
import { logger } from '../../lib/logger';
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
    documentType,
  }: StartVerificationInput): Promise<StartVerificationResult> {
    if (isProduction) {
      logger.warn(
        { documentType },
        'KYC submitted with the stub driver — left PENDING, no provider configured',
      );
      return { providerRef: null, widgetUrl: null, status: 'PENDING' };
    }
    return { providerRef: null, widgetUrl: null, status: 'VERIFIED' };
  }

  /** No remote side, so nothing can legitimately call back. */
  parseWebhook(): KycDecision | null {
    return null;
  }
}

/**
 * Typed as the interface rather than the class, so tests can vi.spyOn this
 * singleton the way auth.test.ts does with emailService.
 *
 * Phase 2 makes this a ternary on env.KYC_PROVIDER_API_KEY, exactly as
 * services/email/index.ts does with RESEND_API_KEY. Only this line changes — the
 * routes, service, schema and UI are all written against the interface.
 */
export const kycProvider: KycProvider = new StubKycProvider();

if (isProduction && !env.KYC_PROVIDER_API_KEY) {
  logger.warn(
    'No KYC provider configured — identity submissions will queue as PENDING and nobody can approve them yet.',
  );
}
