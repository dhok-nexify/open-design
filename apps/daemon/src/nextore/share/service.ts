import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import { randomToken } from '../auth/secrets.js';

type SqliteDb = Database.Database;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Local cap; the module's ShareLinkMaxDays setting is not on bootstrap yet. */
export const MAX_SHARE_LINK_DAYS = 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export interface CreatedShareLink {
  id: string;
  token: string;
  url: string;
  expiresAt: number | null;
}

export interface ShareLinkSummary {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

interface ShareLinkRow {
  token_hash: string;
  project_id: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeShareToken(raw: unknown): string | null {
  const token = typeof raw === 'string' ? raw.trim() : '';
  return TOKEN_PATTERN.test(token) ? token : null;
}

/**
 * Validate a caller-supplied expiry. Undefined/null means "never", which the
 * module permits; a concrete timestamp must be in the future and within the
 * local cap so a client cannot mint a link that outlives policy.
 */
export function resolveShareExpiry(
  raw: unknown,
  now = Date.now(),
  maxDays = MAX_SHARE_LINK_DAYS,
): { ok: true; expiresAt: number | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, expiresAt: null };
  }
  const parsed = typeof raw === 'number'
    ? raw
    : typeof raw === 'string'
      ? Date.parse(raw)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: 'expiresAt must be an ISO timestamp or epoch milliseconds' };
  }
  if (parsed <= now) {
    return { ok: false, message: 'expiresAt must be in the future' };
  }
  if (parsed > now + maxDays * DAY_MS) {
    return { ok: false, message: `expiresAt exceeds the ${maxDays}-day limit` };
  }
  return { ok: true, expiresAt: parsed };
}

export function createShareLink(
  db: SqliteDb,
  input: {
    projectId: string;
    createdByMemberId: number;
    expiresAt: number | null;
    baseUrl: string;
    now?: number;
  },
): CreatedShareLink {
  const token = randomToken(32);
  const id = hashShareToken(token);
  const createdAt = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO nextore_share_links
       (token_hash, project_id, created_by_member_id, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(id, input.projectId, input.createdByMemberId, createdAt, input.expiresAt);
  return {
    id,
    token,
    url: input.baseUrl.replace(/\/+$/, '') + '/s/' + encodeURIComponent(token),
    expiresAt: input.expiresAt,
  };
}

export function listShareLinks(db: SqliteDb, projectId: string): ShareLinkSummary[] {
  const rows = db
    .prepare(
      `SELECT token_hash, project_id, created_at, expires_at, revoked_at
         FROM nextore_share_links
        WHERE project_id = ?
        ORDER BY created_at DESC`,
    )
    .all(projectId) as ShareLinkRow[];
  return rows.map((row) => ({
    id: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

export function revokeShareLink(
  db: SqliteDb,
  projectId: string,
  tokenHash: string,
  now = Date.now(),
): boolean {
  const revoke = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE nextore_share_links
            SET revoked_at = ?
          WHERE token_hash = ? AND project_id = ? AND revoked_at IS NULL`,
      )
      .run(now, tokenHash, projectId);
    if (result.changes > 0) {
      db.prepare('DELETE FROM nextore_share_grants WHERE token_hash = ?').run(tokenHash);
    }
    return result.changes > 0;
  });
  return revoke();
}

/**
 * Validate a token and write the member's grant for its project.
 *
 * The grant row is keyed by (member, project), so opening a second link for
 * the same project refreshes which token authorizes the grant. Revocation or
 * expiry is always checked against the live link row, never cached.
 */
export function resolveShareLink(
  db: SqliteDb,
  input: { token: string; memberId: number; now?: number },
): { projectId: string } | null {
  const token = normalizeShareToken(input.token);
  if (!token) return null;
  const now = input.now ?? Date.now();
  const tokenHash = hashShareToken(token);
  const link = db
    .prepare(
      `SELECT token_hash, project_id, created_at, expires_at, revoked_at
         FROM nextore_share_links
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(tokenHash, now) as ShareLinkRow | undefined;
  if (!link) return null;

  db.prepare(
    `INSERT INTO nextore_share_grants
       (member_id, project_id, token_hash, granted_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(member_id, project_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       granted_at = excluded.granted_at`,
  ).run(input.memberId, link.project_id, tokenHash, now);

  return { projectId: link.project_id };
}

/**
 * True when the member currently holds a live grant for this project. The join
 * makes revocation and expiry take effect immediately, without deleting rows.
 */
export function hasValidShareGrant(
  db: SqliteDb,
  memberId: number,
  projectId: string,
  now = Date.now(),
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok
         FROM nextore_share_grants g
         JOIN nextore_share_links l ON l.token_hash = g.token_hash
        WHERE g.member_id = ?
          AND g.project_id = ?
          AND l.project_id = g.project_id
          AND l.revoked_at IS NULL
          AND (l.expires_at IS NULL OR l.expires_at > ?)
        LIMIT 1`,
    )
    .get(memberId, projectId, now) as { ok?: number } | undefined;
  return row?.ok === 1;
}
