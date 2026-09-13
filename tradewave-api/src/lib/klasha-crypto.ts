import { createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Klasha's request encryption.
 *
 * Several of their endpoints do not take a plain JSON body. The body is
 * serialised, encrypted, and sent as `{"message": "<base64>"}`. This implements
 * the scheme exactly as their documentation specifies it:
 *
 *   3DES (des-ede3-cbc), PKCS5/PKCS7 padding, 24-byte key, base64 output,
 *   and an IV taken from the FIRST 8 BYTES OF THE KEY.
 *
 * ── On the scheme itself ──────────────────────────────────────────────────
 * This is their contract, not our design, and two things about it are worth
 * stating plainly so nobody later mistakes them for choices we made.
 *
 * 3DES was withdrawn by NIST for new use after 2023. And deriving the IV from
 * the key makes it constant for the life of that key, so identical plaintexts
 * produce identical ciphertexts — the property a random IV exists to prevent.
 *
 * Neither is ours to fix: the far end decrypts with these parameters or not at
 * all. What it does mean is that the transport security here is TLS, and this
 * layer should be treated as an encoding their API happens to require rather
 * than as protection for anything sensitive.
 */

const ALGORITHM = 'des-ede3-cbc';
const KEY_BYTES = 24;

function toKey(secret: string): Buffer {
  const key = Buffer.from(secret, 'utf8');
  if (key.length !== KEY_BYTES) {
    // Thrown rather than padded or truncated. A silently reshaped key produces
    // ciphertext the far end rejects with a generic error, and the hours that
    // follow are spent looking anywhere but here.
    throw new Error(
      `Klasha encryption key must be exactly ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

/** Encrypts a payload into the `message` string Klasha expects. */
export function encryptPayload(payload: unknown, secret: string): string {
  const key = toKey(secret);
  const cipher = createCipheriv(ALGORITHM, key, key.subarray(0, 8));
  return cipher.update(JSON.stringify(payload), 'utf8', 'base64') + cipher.final('base64');
}

/** Wraps an encrypted payload in the envelope their endpoints accept. */
export function encryptedBody(payload: unknown, secret: string): { message: string } {
  return { message: encryptPayload(payload, secret) };
}

/**
 * The inverse. Not used against Klasha — nothing they send back is encrypted —
 * but it is what makes encryptPayload testable as a round trip rather than
 * against a hardcoded string nobody can verify.
 */
export function decryptPayload(message: string, secret: string): string {
  const key = toKey(secret);
  const decipher = createDecipheriv(ALGORITHM, key, key.subarray(0, 8));
  return decipher.update(message, 'base64', 'utf8') + decipher.final('utf8');
}
