import { cookies } from 'next/headers';
import { API_URL } from './api';

export interface DocumentListItem {
  kind: 'CERTIFICATE';
  id: string;
  title: string;
  subtitle: string;
  date: string;
  /** Path on the API, relative to its base. */
  href: string;
}

export async function getDocuments(): Promise<DocumentListItem[]> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return [];

  try {
    const res = await fetch(`${API_URL}/documents`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { documents: DocumentListItem[] };
    return body.documents ?? [];
  } catch {
    return [];
  }
}
