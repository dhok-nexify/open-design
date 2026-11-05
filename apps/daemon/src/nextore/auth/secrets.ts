import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface NextoreSecrets {
  /** HMAC key for signed browser cookies. */
  signKey: Buffer;
  /** AES-256 key for tokens at rest. */
  encryptionKey: Buffer;
}

const MIN_SECRET_LENGTH = 32;
const MAX_SIGNED_PAYLOAD_LENGTH = 8 * 1024;

/**
 * Derive independent signing and encryption keys from one deployment secret.
 *
 * The file is hashed rather than used verbatim so both keys are fixed-length,
 * and the two purposes get different subkeys so a cookie signature can never
 * become a token-decryption oracle (or the reverse).
 */
export function deriveNextoreSecrets(raw: string): NextoreSecrets {
  if (raw.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `DESIGNER_SECRET_FILE must contain at least ${MIN_SECRET_LENGTH} characters of random secret (got ${raw.length}).`,
    );
  }

  const master = createHash('sha256').update(raw, 'utf8').digest();
  return {
    signKey: createHmac('sha256', master).update('nxd:cookie', 'utf8').digest(),
    encryptionKey: createHmac('sha256', master).update('nxd:token', 'utf8').digest(),
  };
}

export function loadNextoreSecrets(file: string): NextoreSecrets {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8').trim();
  } catch (error) {
    throw new Error(
      `DESIGNER_SECRET_FILE could not be read (${file}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return deriveNextoreSecrets(raw);
}

/**
 * Load on first use, not at boot.
 *
 * A missing secret must not stop the daemon from starting: an operator needs
 * the process up to see `/api/health` and the error the first sign-in returns.
 */
export function lazyNextoreSecrets(file: string): () => NextoreSecrets {
  let cached: NextoreSecrets | null = null;
  return () => {
    if (!cached) cached = loadNextoreSecrets(file);
    return cached;
  };
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** base64url without padding, the only alphabet we put in a cookie. */
export function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

/**
 * Sign an opaque payload for a cookie: `<base64url(json)>.<base64url(hmac)>`.
 * The payload is readable by the browser on purpose — it holds no secret — but
 * it cannot be altered without the key.
 */
export function signPayload(secrets: NextoreSecrets, payload: unknown): string {
  const body = base64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${base64Url(hmac(secrets.signKey, body))}`;
}

export function verifyPayload<T>(secrets: NextoreSecrets, value: string | undefined): T | null {
  if (!value || value.length > MAX_SIGNED_PAYLOAD_LENGTH) return null;

  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = hmac(secrets.signKey, body);

  let provided: Buffer;
  try {
    provided = fromBase64Url(signature);
  } catch {
    return null;
  }

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    return JSON.parse(fromBase64Url(body).toString('utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * AES-256-GCM for the tokens at rest. The row is a credential: an access token
 * is a live NexTore API key, so a database copy must not be usable on its own.
 */
export function encryptSecret(secrets: NextoreSecrets, plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', secrets.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(secrets: NextoreSecrets, value: Buffer | Uint8Array): string | null {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buffer.length <= IV_BYTES + TAG_BYTES) return null;

  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', secrets.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Constant-time comparison for values that are not secrets but must not be probed. */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A 43-character PKCE verifier and a 32-byte state, both base64url. */
export function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}
