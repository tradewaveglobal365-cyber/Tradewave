import type { DocumentType, KycStatus } from '@prisma/client';

/**
 * The identity-verification contract. Deliberately provider-neutral: no vendor
 * appears in this file, so swapping Dojah for Smile ID is one new class in
 * ./index.ts and nothing else in the codebase moves.
 *
 * Shaped around HOSTED verification — the vendor's widget captures the selfie in
 * the browser and uploads it straight to the vendor. No document or image ever
 * reaches this server, which is why the API needs no bucket, no multipart parser,
 * and holds no identity documents at rest.
 */

export interface StartVerificationInput {
  userId: string;
  documentType: DocumentType;
  /** Raw document number. Used for the lookup; never persisted. */
  documentNumber: string;
  firstName: string;
  lastName: string;
}

export interface StartVerificationResult {
  /** The vendor's id for this attempt. Null when the driver has no remote side. */
  providerRef: string | null;
  /**
   * Where the browser should send the user to capture their selfie. Null means no
   * hosted step is required and `status` below is already final.
   */
  widgetUrl: string | null;
  /** PENDING when a decision is still owed; VERIFIED/REJECTED when already decided. */
  status: Extract<KycStatus, 'PENDING' | 'VERIFIED' | 'REJECTED'>;
  rejectionReason?: string | undefined;
}

export interface KycDecision {
  providerRef: string;
  status: Extract<KycStatus, 'VERIFIED' | 'REJECTED'>;
  rejectionReason?: string | undefined;
}

export interface KycProvider {
  /** Identifies rows this driver wrote. Persisted on KycVerification.provider. */
  readonly name: string;

  startVerification(input: StartVerificationInput): Promise<StartVerificationResult>;

  /**
   * Turns a raw webhook body into a decision, verifying the signature first.
   * Returns null when the payload is not ours, unsigned, or unparseable — callers
   * treat null as "ignore and 200", so a hostile sender learns nothing.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): KycDecision | null;
}
