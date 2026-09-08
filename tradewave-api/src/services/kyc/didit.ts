import { createHmac } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { tokensMatch } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import type {
  KycDecision,
  KycProvider,
  ProviderStatus,
  StartVerificationInput,
  StartVerificationResult,
} from './types';

const BASE_URL = 'https://verification.didit.me';

/** Webhooks older than this are refused, so a captured one cannot be replayed later. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Didit publishes ten session statuses. Collapsing them is the whole reason this
 * mapping is explicit rather than inline: Abandoned and Expired mean the user
 * never finished, which must NOT be recorded as a failed check — it would read to
 * them as a rejection and consume one of their retries.
 */
const STATUS_MAP: Record<string, ProviderStatus> = {
  'Not Started': 'PENDING',
  'In Progress': 'PENDING',
  'Awaiting User': 'PENDING',
  Resubmitted: 'PENDING',
  // Held pending on purpose: a human resolves this in Didit's console and the
  // decision arrives as another webhook.
  'In Review': 'PENDING',
  Approved: 'VERIFIED',
  Declined: 'REJECTED',
  Expired: 'EXPIRED',
  Abandoned: 'EXPIRED',
  'Kyc Expired': 'EXPIRED',
};

interface DiditSessionResponse {
  session_id: string;
  url: string;
  status: string;
  expires_at?: string;
}

interface DiditFeature {
  status?: string;
  score?: number;
  document_type?: string;
  document_number?: string;
  personal_number?: string;
  warnings?: { short_description?: string; long_description?: string }[];
}

/**
 * Didit names document types in prose ("Driver's License"). Map onto our enum so
 * an unrecognised name lands on OTHER rather than throwing away the attempt.
 */
const DOCUMENT_TYPE_MAP: Record<string, DocumentType> = {
  passport: 'PASSPORT',
  'identity card': 'NATIONAL_ID',
  'id card': 'NATIONAL_ID',
  'national id': 'NATIONAL_ID',
  "driver's license": 'DRIVERS_LICENSE',
  'drivers license': 'DRIVERS_LICENSE',
  'driving licence': 'DRIVERS_LICENSE',
  'voter card': 'VOTERS_CARD',
  "voter's card": 'VOTERS_CARD',
  'residence permit': 'RESIDENCE_PERMIT',
};

function mapDocumentType(raw: string | undefined): DocumentType | undefined {
  if (!raw) return undefined;
  return DOCUMENT_TYPE_MAP[raw.trim().toLowerCase()] ?? 'OTHER';
}

interface DiditDecisionResponse {
  session_id: string;
  status: string;
  vendor_data?: string | null;
  liveness_checks?: DiditFeature[] | null;
  face_matches?: DiditFeature[] | null;
  id_verifications?: DiditFeature[] | null;
}

/** Sorts keys recursively so canonical JSON is stable regardless of input order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Whole-valued floats are truncated, matching the signer's normalisation. */
function shortenFloats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shortenFloats);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        shortenFloats(v),
      ]),
    );
  }
  if (typeof value === 'number' && !Number.isInteger(value) && value % 1 === 0) {
    return Math.trunc(value);
  }
  return value;
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** First non-empty warning on a declined feature, for user-facing copy. */
function firstWarning(features: DiditFeature[] | null | undefined): string | undefined {
  for (const f of features ?? []) {
    const w = f.warnings?.[0];
    if (w?.short_description) return w.short_description;
  }
  return undefined;
}

function bestScore(features: DiditFeature[] | null | undefined): number | undefined {
  const scores = (features ?? [])
    .map((f) => f.score)
    .filter((s): s is number => typeof s === 'number');
  return scores.length ? Math.max(...scores) : undefined;
}

export class DiditKycProvider implements KycProvider {
  readonly name = 'didit';

  constructor(
    private readonly apiKey: string,
    private readonly workflowId: string,
    private readonly webhookSecret: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Didit ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async startVerification(
    input: StartVerificationInput,
  ): Promise<StartVerificationResult> {
    // The workflow runs document capture, passive liveness and a face match against
    // the document portrait — all free-tier. expected_details carries only the name
    // we already hold, so the provider can flag a document that does not match the
    // registered account. No document number is sent: the user does not supply one,
    // and the provider extracts it from the document it verifies.
    const session = await this.request<DiditSessionResponse>('/v3/session/', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: this.workflowId,
        vendor_data: input.reference,
        callback: input.returnUrl,
        language: 'en',
        contact_details: { email: input.email, send_notification_emails: false },
        expected_details: {
          first_name: input.firstName,
          last_name: input.lastName,
        },
      }),
    });

    return {
      providerRef: session.session_id,
      redirectUrl: session.url,
      status: STATUS_MAP[session.status] ?? 'PENDING',
      expiresAt: session.expires_at ? new Date(session.expires_at) : undefined,
    };
  }

  async getVerification(providerRef: string): Promise<KycDecision | null> {
    try {
      const d = await this.request<DiditDecisionResponse>(
        `/v3/session/${providerRef}/decision/`,
      );
      return this.toDecision(d);
    } catch (err) {
      logger.warn({ providerRef, err }, 'Didit decision fetch failed');
      return null;
    }
  }

  parseWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): KycDecision | null {
    const signature = header(headers, 'x-signature-v2');
    const timestamp = header(headers, 'x-timestamp');
    if (!signature || !timestamp) return null;

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number.parseInt(timestamp, 10));
    if (!Number.isFinite(age) || age > TIMESTAMP_TOLERANCE_SECONDS) {
      logger.warn({ age }, 'Didit webhook rejected: stale or unparseable timestamp');
      return null;
    }

    const canonical = JSON.stringify(sortKeys(shortenFloats(body)));
    const expected = createHmac('sha256', this.webhookSecret)
      .update(canonical, 'utf8')
      .digest('hex');
    if (!tokensMatch(expected, signature)) {
      logger.warn('Didit webhook rejected: signature mismatch');
      return null;
    }

    return this.toDecision(body as DiditDecisionResponse);
  }

  private toDecision(d: DiditDecisionResponse): KycDecision | null {
    if (!d.vendor_data || !d.session_id) return null;
    const idv = d.id_verifications?.[0];
    const status = STATUS_MAP[d.status];
    if (!status) {
      logger.warn({ status: d.status }, 'Unrecognised Didit status — holding pending');
      return null;
    }

    return {
      reference: d.vendor_data,
      providerRef: d.session_id,
      status,
      rejectionReason:
        status === 'REJECTED'
          ? (firstWarning(d.id_verifications) ??
            firstWarning(d.face_matches) ??
            firstWarning(d.liveness_checks) ??
            'The details you entered could not be matched to your record.')
          : undefined,
      livenessScore: bestScore(d.liveness_checks),
      faceMatchScore: bestScore(d.face_matches),
      // personal_number first: on a national ID that is the NIN, which is the
      // number worth deduping on. document_number is the booklet/card serial.
      documentNumber: idv?.personal_number ?? idv?.document_number,
      documentType: mapDocumentType(idv?.document_type),
    };
  }
}
