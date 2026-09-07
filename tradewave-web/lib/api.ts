import type { ApiErrorBody } from './types';

/**
 * Two different base URLs, because the two runtimes have different constraints.
 *
 * Browser: a relative path in production ('/api/v1'), so requests go to this same
 * origin and Next rewrites them to the API. The session cookie then comes back
 * first-party and the browser keeps it. An absolute cross-domain URL here would
 * make the SameSite=Lax cookie third-party, and it would be silently dropped.
 *
 * Server: must be absolute — Node's fetch rejects relative URLs. Server Components
 * forward the Cookie header explicitly (see session.ts), so they can call the API
 * directly and skip the proxy hop.
 */
const BROWSER_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api/v1';

const SERVER_API_URL = process.env.API_ORIGIN
  ? `${process.env.API_ORIGIN}/api/v1`
  : BROWSER_API_URL;

export const API_URL =
  typeof window === 'undefined' ? SERVER_API_URL : BROWSER_API_URL;

/** Mirrors the API's error envelope so forms can map fields back to inputs. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Every call sends cookies (credentials: 'include') — that is how the session
 * travels, since the tokens are httpOnly and unreadable from JS.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const err = (json as ApiErrorBody).error;
    throw new ApiError(
      res.status,
      err ?? { code: 'UNKNOWN', message: 'Something went wrong. Please try again.' },
    );
  }

  return json as T;
}

/** Turns any thrown value into a message safe to show a user. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) {
    // fetch throws TypeError when it cannot reach the host at all.
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
