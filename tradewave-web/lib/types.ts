/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT MIRROR — the ONLY place the web app describes API payloads.
 *
 * Source of truth: the schema files under tradewave-api/src/modules and the
 * service return types in tradewave-api/src/modules/auth/auth.service.ts.
 * There is no shared package, so when a contract changes, this file and the
 * API schema must be updated together.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
export type Role = 'USER' | 'ADMIN';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  country: string;
  status: UserStatus;
  role: Role;
  emailVerified: boolean;
  referralCode: string;
  createdAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface MessageResponse {
  message: string;
}

export interface SessionResponse {
  user: PublicUser;
}

export interface ReferralSummary {
  code: string;
  shareUrl: string;
  totalReferrals: number;
  verifiedReferrals: number;
}

export interface ReferralListItem {
  displayName: string;
  maskedEmail: string;
  status: UserStatus;
  joinedAt: string;
}

export interface ReferralList {
  items: ReferralListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export type ReferralValidation =
  | { valid: true; referrerFirstName: string }
  | { valid: false };

/** Money always arrives as a string of fils — never a JSON number. */
export type Fils = string;

export type PropertyStatus = 'DRAFT' | 'OPEN' | 'FUNDED' | 'CLOSED';
export type InvestmentStatus = 'ACTIVE' | 'MATURED' | 'CANCELLED';

export interface Property {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  addressLine: string;
  area: string;
  city: string;
  country: string;
  images: string[];
  totalValueFils: Fils;
  minInvestmentFils: Fils;
  fundedFils: Fils;
  remainingFils: Fils;
  fundedProgress: number;
  annualReturnBps: number;
  termMonths: number;
  status: PropertyStatus;
  projectedReturnOnMinimumFils: Fils;
  fundingClosesAt: string | null;
}

export interface PropertyList {
  items: Property[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
