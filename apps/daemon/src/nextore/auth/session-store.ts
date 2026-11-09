import type Database from 'better-sqlite3';
import { decryptSecret, encryptSecret, randomToken, type NextoreSecrets } from './secrets.js';

type SqliteDb = Database.Database;

/** What a signed-in browser is allowed to know about its own session. */
export interface NextoreSession {
  sid: string;
  memberId: number;
  member: NextoreSessionMember;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  createdAt: number;
  lastSeenAt: number;
  lastValidatedAt: number;
}

export interface NextoreSessionFeatures {
  /** Module setting `MemoryEnabled`; false hides the store and stops extraction. */
  memory: boolean;
  /** Module setting `McpEnabled` (NXD-D21). */
  mcp: boolean;
  /** Module setting `ShareLinksEnabled` (NXD-D20). */
  shareLinks: boolean;
}

export interface NextoreSessionMember {
  id: number;
  login: string;
  fullName: string;
  email: string;
  language: string;
  profileObjectId: number;
  /**
   * Feature switches from the last bootstrap response. Optional because rows
   * written before NXD-D19 do not carry it; absent means "all enabled", which
   * is the module default and keeps existing deployments working until the
   * next revalidation refreshes the member.
   */
  features?: NextoreSessionFeatures;
}

interface SessionRow {
  sid: string;
  member_id: number;
  member_json: string;
  access_token_enc: Buffer;
  refresh_token_enc: Buffer | null;
  token_expires_at: number | null;
  created_at: number;
  last_seen_at: number;
  last_validated_at: number;
}

export interface NewNextoreSession {
  memberId: number;
  member: NextoreSessionMember;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
}

export interface TokenUpdate {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  validatedAt: number;
}

/**
 * The `nextore_sessions` table (NXD-D03) behind one narrow interface.
 *
 * Only the daemon reads this table, so it stays a plain store rather than an
 * ORM entity: the OAuth routes are the only writers, and the gate is the only
 * reader that matters.
 */
export interface NextoreSessionStore {
  create(session: NewNextoreSession): NextoreSession;
  find(sid: string): NextoreSession | null;
  touch(sid: string, seenAt: number): void;
  updateTokens(sid: string, update: TokenUpdate): void;
  recordValidation(sid: string, validatedAt: number, member: NextoreSessionMember): void;
  remove(sid: string): void;
  /** Delete rows whose last activity is older than the caller's session TTL. */
  pruneExpired(before: number): number;
}

function toFeatures(value: unknown): NextoreSessionFeatures {
  if (!value || typeof value !== 'object') {
    // Rows written before NXD-D19 have no features; all-on matches the module
    // default and is refreshed by the next bootstrap revalidation.
    return { memory: true, mcp: true, shareLinks: true };
  }
  const raw = value as Partial<NextoreSessionFeatures>;
  return {
    memory: raw.memory !== false,
    mcp: raw.mcp !== false,
    shareLinks: raw.shareLinks !== false,
  };
}

function toMember(raw: string): NextoreSessionMember | null {
  try {
    const value = JSON.parse(raw) as Partial<NextoreSessionMember> | null;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.id !== 'number' || value.id <= 0) return null;
    return {
      id: value.id,
      login: typeof value.login === 'string' ? value.login : '',
      fullName: typeof value.fullName === 'string' ? value.fullName : '',
      email: typeof value.email === 'string' ? value.email : '',
      language: typeof value.language === 'string' ? value.language : '',
      profileObjectId: typeof value.profileObjectId === 'number' ? value.profileObjectId : 0,
      features: toFeatures(value.features),
    };
  } catch {
    return null;
  }
}

export function createNextoreSessionStore(
  getDb: () => SqliteDb | null,
  getSecrets: () => NextoreSecrets,
): NextoreSessionStore {
  function secrets(): NextoreSecrets {
    return getSecrets();
  }

  function db(): SqliteDb {
    const instance = getDb();
    if (!instance) throw new Error('The NexTore session store is not ready: the database is closed.');
    return instance;
  }

  function decode(row: SessionRow): NextoreSession | null {
    const member = toMember(row.member_json);
    const accessToken = decryptSecret(secrets(), row.access_token_enc);
    if (!member || !accessToken) return null;

    const refreshToken = row.refresh_token_enc
      ? decryptSecret(secrets(), row.refresh_token_enc)
      : null;

    return {
      sid: row.sid,
      memberId: row.member_id,
      member,
      accessToken,
      refreshToken,
      tokenExpiresAt: row.token_expires_at,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      lastValidatedAt: row.last_validated_at,
    };
  }

  return {
    create(session) {
      const now = Date.now();
      const sid = randomToken(32);
      db()
        .prepare(
          `INSERT INTO nextore_sessions
             (sid, member_id, member_json, access_token_enc, refresh_token_enc,
              token_expires_at, created_at, last_seen_at, last_validated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sid,
          session.memberId,
          JSON.stringify(session.member),
          encryptSecret(secrets(), session.accessToken),
          session.refreshToken ? encryptSecret(secrets(), session.refreshToken) : null,
          session.tokenExpiresAt,
          now,
          now,
          now,
        );

      return {
        sid,
        memberId: session.memberId,
        member: session.member,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        tokenExpiresAt: session.tokenExpiresAt,
        createdAt: now,
        lastSeenAt: now,
        lastValidatedAt: now,
      };
    },

    find(sid) {
      const row = db().prepare('SELECT * FROM nextore_sessions WHERE sid = ?').get(sid) as
        | SessionRow
        | undefined;
      if (!row) return null;

      const session = decode(row);
      if (!session) {
        // A row that cannot be decrypted (rotated secret, corrupt ciphertext)
        // is unusable forever; deleting it keeps a dead credential from
        // lingering in the database.
        db().prepare('DELETE FROM nextore_sessions WHERE sid = ?').run(sid);
      }
      return session;
    },

    touch(sid, seenAt) {
      db().prepare('UPDATE nextore_sessions SET last_seen_at = ? WHERE sid = ?').run(seenAt, sid);
    },

    updateTokens(sid, update) {
      db()
        .prepare(
          `UPDATE nextore_sessions
              SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?,
                  last_seen_at = ?, last_validated_at = ?
            WHERE sid = ?`,
        )
        .run(
          encryptSecret(secrets(), update.accessToken),
          update.refreshToken ? encryptSecret(secrets(), update.refreshToken) : null,
          update.tokenExpiresAt,
          update.validatedAt,
          update.validatedAt,
          sid,
        );
    },

    recordValidation(sid, validatedAt, member) {
      db()
        .prepare(
          `UPDATE nextore_sessions
              SET member_json = ?, last_validated_at = ?, last_seen_at = ?
            WHERE sid = ?`,
        )
        .run(JSON.stringify(member), validatedAt, validatedAt, sid);
    },

    remove(sid) {
      db().prepare('DELETE FROM nextore_sessions WHERE sid = ?').run(sid);
    },

    pruneExpired(before) {
      return db().prepare('DELETE FROM nextore_sessions WHERE last_seen_at < ?').run(before).changes;
    },
  };
}
