import { API_URL } from './api';
import type { Property, PropertyList } from './types';

/**
 * Properties are public, so these do not forward cookies. They are still
 * `no-store`: funding progress changes as people invest, and a cached grid
 * showing stale availability would let someone start an investment that
 * cannot complete.
 */
export async function getProperties(page = 1): Promise<PropertyList | null> {
  try {
    const res = await fetch(`${API_URL}/properties?page=${page}&perPage=12`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PropertyList;
  } catch {
    return null;
  }
}

export async function getProperty(slug: string): Promise<Property | null> {
  try {
    const res = await fetch(`${API_URL}/properties/${slug}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { property: Property };
    return body.property;
  } catch {
    return null;
  }
}
