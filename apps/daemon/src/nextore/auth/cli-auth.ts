import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

import { hashApiToken } from './api-tokens.js';

type SqliteDb = Database.Database;

export const CLI_CODE_TTL_MS = 2 * 60 * 1000;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS nextore_cli_codes (
    code_hash TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL,
    session_sid TEXT,
    challenge TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  );
`;

export interface IssuedCliCode {
  code: string;
  expiresAt: number;
}

export interface RedeemedCliToken {
  memberId: number;
  sessionSid: string | null;
}

export function ensureCliCodeSchema(db: SqliteDb): void {
  db.exec(SCHEMA_SQL);
}

/** PKCE S256: base64url(sha256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Issue a one-time authorization code bound to a browser session.
 *
 * The code carries the PKCE challenge and the caller's state, so possession of
 * the code alone is not enough to mint a token.
 */
export function issueCliCode(
  db: SqliteDb,
  input: { memberId: number; sessionSid: string | null; challenge: string; state: string; now?: number },
): IssuedCliCode {
  ensureCliCodeSchema(db);
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.challenge)) throw new Error('invalid challenge');
  if (!input.state || input.state.length > 256) throw new Error('invalid state');
  const code = randomBytes(32).toString('base64url');
  const now = input.now ?? Date.now();
  const expiresAt = now + CLI_CODE_TTL_MS;
  db.prepare(`
    INSERT INTO nextore_cli_codes
      (code_hash, member_id, session_sid, challenge, state, created_at, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(hashApiToken(code), input.memberId, input.sessionSid, input.challenge, input.state, now, expiresAt);
  return { code, expiresAt };
}

/**
 * Redeem a code exactly once. Returns null for an unknown, expired, replayed or
 * mismatched (state / PKCE) redemption — the caller only sees "invalid_grant".
 */
export function redeemCliCode(
  db: SqliteDb,
  input: { code: string; verifier: string; state: string; now?: number },
): RedeemedCliToken | null {
  ensureCliCodeSchema(db);
  const now = input.now ?? Date.now();
  const row = db.prepare(`
    SELECT code_hash, member_id, session_sid, challenge, state, expires_at, consumed_at
      FROM nextore_cli_codes WHERE code_hash = ?
  `).get(hashApiToken(input.code)) as {
    code_hash: string;
    member_id: number;
    session_sid: string | null;
    challenge: string;
    state: string;
    expires_at: number;
    consumed_at: number | null;
  } | undefined;
  if (!row) return null;
  if (row.consumed_at !== null) return null;
  if (row.expires_at <= now) return null;
  if (!constantTimeEqual(row.state, input.state)) return null;
  if (!constantTimeEqual(row.challenge, codeChallengeS256(input.verifier))) return null;

  const consumed = db.prepare(`
    UPDATE nextore_cli_codes SET consumed_at = ?
     WHERE code_hash = ? AND consumed_at IS NULL
  `).run(now, row.code_hash);
  if (consumed.changes !== 1) return null;
  return { memberId: row.member_id, sessionSid: row.session_sid };
}

/** Housekeeping for the one-time code table. */
export function pruneCliCodes(db: SqliteDb, before = Date.now()): number {
  ensureCliCodeSchema(db);
  const result = db.prepare('DELETE FROM nextore_cli_codes WHERE expires_at <= ?').run(before);
  return result.changes;
}
