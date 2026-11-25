import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

export const API_TOKEN_PREFIX = 'odt_';
export const API_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Scopes a CLI token can hold. Admin settings are deliberately absent. */
export const API_TOKEN_SCOPES = ['project:read', 'project:write', 'run:create'] as const;
export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];

export interface ApiTokenRow {
  /** The browser session that approved this token, when the login flow recorded one. */
  sessionSid: string | null;
  id: string;
  memberId: number;
  scopes: ApiTokenScope[];
  label: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS nextore_api_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    member_id INTEGER NOT NULL,
    scopes TEXT NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    last_used_at INTEGER,
    session_sid TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_nextore_api_tokens_member
    ON nextore_api_tokens(member_id, revoked_at);
`;

export function ensureApiTokenSchema(db: SqliteDb): void {
  db.exec(SCHEMA_SQL);
  // Additive for databases created before the token recorded which browser
  // session approved it.
  const columns = db.prepare('PRAGMA table_info(nextore_api_tokens)').all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === 'session_sid')) {
    db.exec('ALTER TABLE nextore_api_tokens ADD COLUMN session_sid TEXT');
  }
}

export function hashApiToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Issue one CLI token. The raw value is returned exactly once; only its
 * SHA-256 digest is stored, so a database read can never replay a token.
 */
export function createApiToken(
  db: SqliteDb,
  input: {
    memberId: number;
    scopes: readonly string[];
    label?: string | null;
    sessionSid?: string | null;
    now?: number;
    ttlMs?: number;
  },
): { id: string; token: string; scopes: ApiTokenScope[]; expiresAt: number } {
  ensureApiTokenSchema(db);
  if (!Number.isInteger(input.memberId) || input.memberId <= 0) {
    throw new Error('memberId is required');
  }
  if (input.scopes.some((scope) => !(API_TOKEN_SCOPES as readonly string[]).includes(scope))) {
    throw new Error('unknown scope');
  }
  const scopes = [...input.scopes];
  if (scopes.length === 0) throw new Error('at least one scope is required');

  const raw = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const now = input.now ?? Date.now();
  const expiresAt = now + (input.ttlMs ?? API_TOKEN_TTL_MS);
  const id = randomBytes(12).toString('hex');
  db.prepare(`
    INSERT INTO nextore_api_tokens
      (id, token_hash, member_id, scopes, label, created_at, expires_at, revoked_at, last_used_at, session_sid)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `).run(
    id,
    hashApiToken(raw),
    input.memberId,
    scopes.join(' '),
    input.label ?? null,
    now,
    expiresAt,
    input.sessionSid ?? null,
  );

  return { id, token: raw, scopes: scopes as ApiTokenScope[], expiresAt };
}

export function verifyApiToken(
  db: SqliteDb,
  raw: string,
  now = Date.now(),
): ApiTokenRow | null {
  ensureApiTokenSchema(db);
  if (typeof raw !== 'string' || !raw.startsWith(API_TOKEN_PREFIX)) return null;
  const row = db.prepare(`
    SELECT id, member_id, scopes, label, created_at, expires_at, revoked_at, last_used_at, session_sid
      FROM nextore_api_tokens
     WHERE token_hash = ?
  `).get(hashApiToken(raw)) as {
    id: string;
    member_id: number;
    scopes: string;
    label: string | null;
    created_at: number;
    expires_at: number;
    revoked_at: number | null;
    last_used_at: number | null;
    session_sid: string | null;
  } | undefined;
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at <= now) return null;

  if (row.last_used_at === null || now - row.last_used_at > 60_000) {
    db.prepare('UPDATE nextore_api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
  }
  return {
    sessionSid: row.session_sid,
    id: row.id,
    memberId: row.member_id,
    scopes: row.scopes.split(' ').filter(Boolean) as ApiTokenScope[],
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: now,
  };
}

export function revokeApiToken(db: SqliteDb, memberId: number, id: string, now = Date.now()): boolean {
  ensureApiTokenSchema(db);
  const result = db.prepare(`
    UPDATE nextore_api_tokens SET revoked_at = ?
     WHERE id = ? AND member_id = ? AND revoked_at IS NULL
  `).run(now, id, memberId);
  return result.changes > 0;
}

export function listApiTokens(db: SqliteDb, memberId: number): ApiTokenRow[] {
  ensureApiTokenSchema(db);
  const rows = db.prepare(`
    SELECT id, member_id, scopes, label, created_at, expires_at, revoked_at, last_used_at, session_sid
      FROM nextore_api_tokens
     WHERE member_id = ?
     ORDER BY created_at DESC
  `).all(memberId) as Array<{
    id: string;
    member_id: number;
    scopes: string;
    label: string | null;
    created_at: number;
    expires_at: number;
    revoked_at: number | null;
    last_used_at: number | null;
    session_sid: string | null;
  }>;
  return rows.map((row) => ({
    sessionSid: row.session_sid,
    id: row.id,
    memberId: row.member_id,
    scopes: row.scopes.split(' ').filter(Boolean) as ApiTokenScope[],
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  }));
}

/**
 * Route-level scope policy.
 *
 * A CLI token may read projects and start runs; it may never reach the
 * settings/admin surface, and every write needs project:write.
 */
export function apiTokenAllowsRequest(
  token: Pick<ApiTokenRow, 'scopes'>,
  method: string,
  path: string,
): boolean {
  if (path.startsWith('/settings') || path.includes('/admin')) return false;
  if (method === 'GET' || method === 'HEAD') {
    return token.scopes.includes('project:read') || token.scopes.includes('project:write');
  }
  if (path.endsWith('/runs') || path.includes('/runs/')) {
    return token.scopes.includes('run:create');
  }
  return token.scopes.includes('project:write');
}
