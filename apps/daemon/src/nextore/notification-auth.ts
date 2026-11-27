import { createHmac, createHash } from 'node:crypto';

/**
 * Daemon side of the signed daemon -> module notification contract.
 *
 * The module signs a canonical list of typed fields rather than raw HTTP bytes; both
 * sides must construct the identical string. Field values are base64url encoded so
 * separators and non-ASCII text cannot change the field boundaries.
 */

export function encodeServiceField(value: string | number | boolean | null | undefined): string {
  if (value == null) return '';
  const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  return Buffer.from(text, 'utf8').toString('base64url');
}

export function canonicalNotificationFields(fields: readonly (readonly [string, string])[]): string {
  return fields.map(([key, value]) => `${key}=${value}`).join('\n');
}

export function signNotification(secret: string, timestamp: string, canonicalBody: string): string {
  return createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.')
    .update(canonicalBody, 'utf8')
    .digest('hex');
}

export function stableNotificationEventId(prefix: string, identity: string): string {
  return prefix + createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32);
}

export function notificationHeaders(
  secret: string,
  eventId: string,
  canonicalBody: string,
  now = Date.now(),
): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  return {
    'X-NXD-Event-Id': eventId,
    'X-NXD-Timestamp': timestamp,
    'X-NXD-Signature': 'v1=' + signNotification(secret, timestamp, canonicalBody),
  };
}
