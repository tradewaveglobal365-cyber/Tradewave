import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

/**
 * Listing photographs, in Supabase Storage.
 *
 * Files arrive at our own API and are forwarded from here, rather than the
 * browser being handed a signed URL and uploading directly. That is slightly
 * more work and buys three things: authorisation is requireRole('ADMIN') rather
 * than a Supabase bucket policy, the service-role key never reaches a browser,
 * and the type and size are checked before anything is stored.
 *
 * The REST contract (Supabase docs, standard uploads):
 *   POST {url}/storage/v1/object/{bucket}/{path}
 *   apikey, Authorization: Bearer <key>, Content-Type: <the file's>
 * Standard upload is recommended up to 6MB, comfortably above any listing photo.
 */

/** Exactly what a browser may send. Anything else is refused before storage. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isStorageConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export class StorageError extends Error {}

/**
 * Stores one image and returns the URL to save on the property.
 *
 * The filename is a UUID rather than anything derived from the upload. A
 * client-supplied name would let someone overwrite an existing listing's photo
 * by guessing it, and would drag path traversal into a storage key.
 */
export async function uploadPropertyImage(
  body: Buffer,
  contentType: string,
): Promise<string> {
  if (!isStorageConfigured()) {
    throw new StorageError('Image storage is not configured.');
  }
  if (!ALLOWED_IMAGE_TYPES.includes(contentType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw new StorageError('Images must be JPEG, PNG or WebP.');
  }
  if (body.length === 0) throw new StorageError('The file is empty.');
  if (body.length > MAX_IMAGE_BYTES) {
    throw new StorageError('Images must be 6MB or smaller.');
  }

  const path = `${new Date().getFullYear()}/${randomUUID()}.${EXTENSIONS[contentType]}`;
  const base = env.SUPABASE_URL.replace(/\/$/, '');

  const res = await fetch(
    `${base}/storage/v1/object/${env.SUPABASE_PROPERTY_BUCKET}/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
        // No x-upsert: a UUID path cannot collide, so an "already exists" here
        // would mean something is wrong and should surface rather than overwrite.
      },
      body: new Uint8Array(body),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail: detail.slice(0, 200) }, 'Supabase upload failed');
    throw new StorageError('Could not store the image. Please try again.');
  }

  return `${base}/storage/v1/object/public/${env.SUPABASE_PROPERTY_BUCKET}/${path}`;
}
