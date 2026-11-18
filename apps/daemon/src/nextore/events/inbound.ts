import { createHmac, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

export const EVENT_MAX_SKEW_SECONDS = 300;
export const EVENT_DEDUPE_MS = 10 * 60 * 1000;

export type NextoreEventType =
  | 'permission.changed'
  | 'project.deleted'
  | 'project.moved'
  | 'member.locked'
  | 'member.deleted';

export interface NextoreEvent {
  id: string;
  type: string;
  at: number;
  sequence?: number;
  memberId?: number;
  projectId?: string;
  treeObjectId?: number;
  payload?: unknown;
}

export type EventRejectReason =
  | 'missing_headers'
  | 'invalid_content_type'
  | 'timestamp_skew'
  | 'bad_signature'
  | 'malformed_body'
  | 'replayed'
  | 'stale_sequence';

export interface EventVerifyInput {
  rawBody: Buffer;
  eventId: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  contentType: string | undefined;
  secrets: readonly string[];
  now?: () => number;
}

export interface EventVerifyResult {
  ok: boolean;
  reason?: EventRejectReason;
  event?: NextoreEvent;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS nextore_event_inbox (
    event_id TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS nextore_event_sequences (
    scope TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

export function ensureEventSchema(db: SqliteDb): void {
  db.exec(SCHEMA_SQL);
}

function hmac(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(timestamp, 'utf8').update('.').update(rawBody).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify one inbound push using the RAW request body.
 *
 * Re-serialising the parsed JSON would change byte order and whitespace, so the
 * signature only ever covers the bytes that arrived.
 */
export function verifyEvent(input: EventVerifyInput): EventVerifyResult {
  if (input.contentType && !input.contentType.toLowerCase().startsWith('application/json')) {
    return { ok: false, reason: 'invalid_content_type' };
  }
  if (!input.eventId || !input.timestamp || !input.signature) {
    return { ok: false, reason: 'missing_headers' };
  }
  const nowSeconds = Math.floor((input.now ?? Date.now)() / 1000);
  const sent = Number(input.timestamp);
  if (!Number.isFinite(sent) || Math.abs(nowSeconds - sent) > EVENT_MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'timestamp_skew' };
  }
  const presented = input.signature.startsWith('v1=') ? input.signature.slice(3) : input.signature;
  const matched = input.secrets.some((secret) => safeEqual(hmac(secret, input.timestamp!, input.rawBody), presented));
  if (!matched) return { ok: false, reason: 'bad_signature' };

  let event: NextoreEvent;
  try {
    event = JSON.parse(input.rawBody.toString('utf8')) as NextoreEvent;
  } catch {
    return { ok: false, reason: 'malformed_body' };
  }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    return { ok: false, reason: 'malformed_body' };
  }
  return { ok: true, event };
}

/** Record the id and advance the scope sequence atomically. */
export function acceptEvent(
  db: SqliteDb,
  event: NextoreEvent,
  now = Date.now(),
): { accepted: boolean; reason?: EventRejectReason } {
  ensureEventSchema(db);
  const scope = event.projectId ? 'project:' + event.projectId : event.memberId ? 'member:' + event.memberId : null;
  const run = db.transaction(() => {
    const inserted = db.prepare(
      'INSERT OR IGNORE INTO nextore_event_inbox (event_id, received_at) VALUES (?, ?)',
    ).run(event.id, now);
    if (inserted.changes === 0) return { accepted: false, reason: 'replayed' as const };

    if (scope && typeof event.sequence === 'number' && Number.isInteger(event.sequence)) {
      const row = db.prepare('SELECT sequence FROM nextore_event_sequences WHERE scope = ?')
        .get(scope) as { sequence: number } | undefined;
      if (row && event.sequence <= row.sequence) {
        return { accepted: false, reason: 'stale_sequence' as const };
      }
      db.prepare(`
        INSERT INTO nextore_event_sequences (scope, sequence, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET sequence = excluded.sequence, updated_at = excluded.updated_at
      `).run(scope, event.sequence, now);
    }
    return { accepted: true };
  });
  const result = run();
  // Keep the dedupe window bounded.
  db.prepare('DELETE FROM nextore_event_inbox WHERE received_at < ?').run(now - EVENT_DEDUPE_MS);
  return result;
}

export interface EventHooks {
  onPermissionChanged: (projectId: string) => void;
  onProjectGone: (projectId: string) => void;
  onMemberDisabled: (memberId: number) => void;
}

/** Dispatch a verified, accepted event. Unknown types are ignored. */
export function dispatchEvent(event: NextoreEvent, hooks: EventHooks): boolean {
  switch (event.type) {
    case 'permission.changed':
      if (event.projectId) hooks.onPermissionChanged(event.projectId);
      return true;
    case 'project.deleted':
    case 'project.moved':
      if (event.projectId) hooks.onProjectGone(event.projectId);
      return true;
    case 'member.locked':
    case 'member.deleted':
      if (typeof event.memberId === 'number') hooks.onMemberDisabled(event.memberId);
      return true;
    default:
      return false;
  }
}
