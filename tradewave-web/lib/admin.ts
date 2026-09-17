import { cookies } from 'next/headers';
import { API_URL } from './api';

export interface FxRateView {
  baseCurrency: string;
  quoteCurrency: string;
  /** Kobo per dollar, as a string. Null when no rate has ever been published. */
  minorPerUnit: string | null;
  effectiveAt: string | null;
}

export interface AdminDeposit {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED';
  providerRef: string;
  sourceAmountMinor: string | null;
  sourceCurrency: string;
  amountCents: string;
  rateMinorPerUnit: string | null;
  paidAt: string | null;
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string };
}

async function authedGet<T>(path: string): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getFxRate(): Promise<FxRateView | null> {
  return authedGet<FxRateView>('/fx/rate');
}

export async function getAdminDeposits(): Promise<AdminDeposit[]> {
  const body = await authedGet<{ deposits: AdminDeposit[] }>('/admin/deposits');
  return body?.deposits ?? [];
}

export interface AdminProperty {
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
  totalValueCents: string;
  minInvestmentCents: string;
  fundedCents: string;
  remainingCents: string;
  fundedProgress: number;
  annualReturnBps: number;
  termMonths: number;
  status: 'DRAFT' | 'OPEN' | 'FUNDED' | 'CLOSED';
  fundingClosesAt: string | null;
  investorCount: number;
  /** False once anyone has invested — the form disables the money fields on it. */
  moneyEditable: boolean;
}

export async function getAdminProperties(): Promise<AdminProperty[]> {
  const body = await authedGet<{ properties: AdminProperty[] }>('/admin/properties');
  return body?.properties ?? [];
}

export async function getAdminProperty(id: string): Promise<AdminProperty | null> {
  const body = await authedGet<{ property: AdminProperty }>(`/admin/properties/${id}`);
  return body?.property ?? null;
}

// ── Investors ────────────────────────────────────────────────────────────────

export interface AdminInvestorRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  role: string;
  kycStatus: string;
  emailVerified: boolean;
  balanceCents: string;
  investedCents: string;
  investmentCount: number;
  hasPayoutAccount: boolean;
  createdAt: string;
}

export interface AdminInvestorList {
  investors: AdminInvestorRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminInvestorDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  country: string;
  status: string;
  role: string;
  kycStatus: string;
  emailVerified: boolean;
  kycVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;

  referralCode: string;
  referredBy: { id: string; firstName: string; lastName: string } | null;
  referralCount: number;

  balanceCents: string;
  entries: {
    id: string;
    type: string;
    amountCents: string;
    balanceAfterCents: string;
    description: string;
    createdAt: string;
  }[];

  investments: {
    id: string;
    propertyTitle: string;
    propertySlug: string;
    principalCents: string;
    annualReturnBps: number;
    termMonths: number;
    status: string;
    investedAt: string;
    maturesAt: string;
  }[];

  payoutAccount: {
    bankName: string;
    accountNumberMasked: string;
    accountName: string;
    nameResolved: boolean;
  } | null;

  depositAccount: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  } | null;

  kyc: {
    provider: string;
    status: string;
    documentType: string | null;
    documentLast4: string | null;
    rejectionReason: string | null;
    submittedAt: string;
    decidedAt: string | null;
  } | null;
}

export async function getAdminInvestors(params: {
  q?: string;
  page?: number;
}): Promise<AdminInvestorList | null> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.page && params.page > 1) search.set('page', String(params.page));
  const qs = search.toString();
  return authedGet<AdminInvestorList>(`/admin/investors${qs ? `?${qs}` : ''}`);
}

export async function getAdminInvestor(id: string): Promise<AdminInvestorDetail | null> {
  const body = await authedGet<{ investor: AdminInvestorDetail }>(
    `/admin/investors/${id}`,
  );
  return body?.investor ?? null;
}

// ── Identity review queue ────────────────────────────────────────────────────

export interface AdminReviewRow {
  verificationId: string;
  providerRef: string | null;
  providerStatus: string | null;
  submittedAt: string;
  waitingHours: number;
  livenessScore: number | null;
  faceMatchScore: number | null;
  documentType: string | null;
  user: { id: string; email: string; firstName: string; lastName: string };
}

export async function getPendingReviews(): Promise<AdminReviewRow[]> {
  const body = await authedGet<{ reviews: AdminReviewRow[] }>('/admin/identity/reviews');
  return body?.reviews ?? [];
}

// ── Withdrawals ──────────────────────────────────────────────────────────────

export interface AdminWithdrawal {
  id: string;
  status: string;
  amountCents: string;
  feeCents: string;
  netCents: string;
  bankName: string;
  bankCode: string;
  accountNumberMasked: string;
  accountName: string;
  destinationAmountMinor: string | null;
  rateMinorPerUnit: string | null;
  provider: string;
  providerRef: string | null;
  failureReason: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  waitingHours: number;
  /** The destination moved in the last week — the thing a reviewer is here for. */
  destinationChangedRecently: boolean;
  nameResolved: boolean;
  user: { id: string; email: string; firstName: string; lastName: string };
}

export async function getAdminWithdrawals(): Promise<AdminWithdrawal[]> {
  const body = await authedGet<{ withdrawals: AdminWithdrawal[] }>('/admin/withdrawals');
  return body?.withdrawals ?? [];
}

export interface WithdrawalWindowSettings {
  enabled: boolean;
  /** 0 = Sunday through 6 = Saturday. */
  daysOfWeek: number[];
  /** Minutes from midnight, in `timezone`. */
  opensAtMinute: number;
  closesAtMinute: number;
  timezone: string;
  updatedAt: string;
}

export interface WithdrawalWindowState {
  open: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export async function getWithdrawalWindow(): Promise<{
  window: WithdrawalWindowSettings;
  state: WithdrawalWindowState;
} | null> {
  return authedGet<{ window: WithdrawalWindowSettings; state: WithdrawalWindowState }>(
    '/admin/withdrawal-window',
  );
}

// ── Maturities ───────────────────────────────────────────────────────────────

export interface AdminMaturity {
  investmentId: string;
  maturesAt: string;
  /** Negative once overdue — the case staff actually need to see. */
  daysUntil: number;
  principalCents: string;
  payoutCents: string;
  status: string;
  propertyTitle: string;
  user: { id: string; email: string; firstName: string; lastName: string };
}

export async function getAdminMaturities(): Promise<AdminMaturity[]> {
  const body = await authedGet<{ maturities: AdminMaturity[] }>('/admin/maturities');
  return body?.maturities ?? [];
}
