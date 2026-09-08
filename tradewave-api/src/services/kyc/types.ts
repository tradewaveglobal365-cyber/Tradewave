import type { DocumentType, KycStatus } from '@prisma/client';

/**
 * The identity-verification contract. Deliberately provider-neutral: no vendor
 * appears in this file, so replacing one is a new class in ./ and nothing else in
 * the codebase moves.
 *
 * Shaped around HOSTED verification — the vendor's own page captures the selfie
 * and uploads it straight to the vendor. No document or image ever reaches this
 * server, which is why the API needs no bucket, no multipart parser, and holds no
 * identity documents at rest.
 */

export interface StartVerificationInput {
  /** Our KycVerification.id. Correlates the provider's callbacks back to a row. */
  reference: string;
  documentType: DocumentType;
  /** Raw document number. Sent to the provider; never persisted by us. */
  documentNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Where the provider returns the user when they are done. */
  returnUrl: string;
}

/** Anything not terminal is PENDING; the caller never sees provider vocabulary. */
export type ProviderStatus = Extract<
  KycStatus,
  'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED'
>;

export interface StartVerificationResult {
  /** The vendor's id for this attempt. Null when the driver has no remote side. */
  providerRef: string | null;
  /**
   * Where to send the browser to finish. Null means no hosted step is required
   * and `status` below is already final.
   */
  redirectUrl: string | null;
  status: ProviderStatus;
  rejectionReason?: string | undefined;
  expiresAt?: Date | undefined;
}

export interface KycDecision {
  /** Our KycVerification.id, echoed back by the provider. */
  reference: string;
  providerRef: string;
  status: ProviderStatus;
  rejectionReason?: string | undefined;
  livenessScore?: number | undefined;
  faceMatchScore?: number | undefined;
}

export interface KycProvider {
  /** Identifies rows this driver wrote. Persisted on KycVerification.provider. */
  readonly name: string;

  startVerification(input: StartVerificationInput): Promise<StartVerificationResult>;

  /**
   * Re-reads a decision from the provider.
   *
   * Two jobs: reconciling a webhook that never arrived, and local development,
   * where the provider cannot reach localhost so webhooks never arrive at all.
   * Returns null when the provider has no record of the reference.
   */
  getVerification(providerRef: string): Promise<KycDecision | null>;

  /**
   * Verifies the signature and normalises a webhook body into a decision.
   *
   * Takes the PARSED body rather than raw bytes: the signature scheme we use
   * canonicalises the JSON before signing precisely so it survives middleware
   * re-encoding, which means app.ts keeps its ordinary body-parser order.
   *
   * Returns null when the signature does not verify or the payload is not ours.
   * Callers treat null as "ignore and 200", so a hostile sender learns nothing.
   */
  parseWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): KycDecision | null;
}
