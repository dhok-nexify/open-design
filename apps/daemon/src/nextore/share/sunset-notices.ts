import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

/** Buckets that actually trigger a notice; expired/never/later never send. */
export const SUNSET_NOTICE_BUCKETS = ['t30', 't7', 't1'] as const;
export type SunsetNoticeBucket = typeof SUNSET_NOTICE_BUCKETS[number];

export interface SunsetCandidate {
  linkId: string;
  projectId: string;
  createdByMemberId: number;
  expiresAt: number | null;
  bucket: string;
}

export interface ShareSunsetSweepDeps {
  db: SqliteDb;
  /** Active, unrevoked legacy links with their current bucket. */
  listCandidates: () => SunsetCandidate[];
  /** Deliver one notice. 'failed' means "do not record; retry next sweep". */
  send: (candidate: SunsetCandidate, bucket: SunsetNoticeBucket) => Promise<'sent' | 'skipped' | 'failed'>;
  now?: () => number;
}

export interface ShareSunsetSweepResult {
  sent: number;
  skippedDuplicate: number;
  skippedNotEligible: number;
  failed: number;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS nextore_share_sunset_notices (
    link_id TEXT NOT NULL,
    bucket TEXT NOT NULL CHECK (bucket IN ('t30', 't7', 't1')),
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (link_id, bucket)
  );
`;

export function ensureSunsetNoticeSchema(db: SqliteDb): void {
  db.exec(SCHEMA_SQL);
}

function alreadySent(db: SqliteDb, linkId: string, bucket: string): boolean {
  return Boolean(db.prepare(
    'SELECT 1 AS present FROM nextore_share_sunset_notices WHERE link_id = ? AND bucket = ?',
  ).get(linkId, bucket));
}

function record(db: SqliteDb, linkId: string, bucket: string, at: number): void {
  db.prepare(`
    INSERT INTO nextore_share_sunset_notices (link_id, bucket, sent_at)
    VALUES (?, ?, ?)
    ON CONFLICT(link_id, bucket) DO NOTHING
  `).run(linkId, bucket, at);
}

/**
 * P04h sunset notice sweep.
 *
 * One notice per (link, bucket). A link moving t30 -> t7 -> t1 therefore sends
 * up to three times over its lifetime, once per window, and never twice in the
 * same window. A failed delivery is NOT recorded, so the next sweep retries it;
 * expired links never notify.
 */
export async function runShareSunsetSweep(
  deps: ShareSunsetSweepDeps,
): Promise<ShareSunsetSweepResult> {
  ensureSunsetNoticeSchema(deps.db);
  const now = deps.now ?? Date.now;
  const result: ShareSunsetSweepResult = {
    sent: 0, skippedDuplicate: 0, skippedNotEligible: 0, failed: 0,
  };

  for (const candidate of deps.listCandidates()) {
    const bucket = candidate.bucket as SunsetNoticeBucket;
    if (!(SUNSET_NOTICE_BUCKETS as readonly string[]).includes(bucket)) {
      result.skippedNotEligible += 1;
      continue;
    }
    if (alreadySent(deps.db, candidate.linkId, bucket)) {
      result.skippedDuplicate += 1;
      continue;
    }
    const outcome = await deps.send(candidate, bucket);
    if (outcome === 'failed') {
      result.failed += 1;
      continue;
    }
    record(deps.db, candidate.linkId, bucket, now());
    result.sent += 1;
  }
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type SunsetBucket = 'never' | 'expired' | 't1' | 't7' | 't30' | 'later';

/**
 * Single bucketing rule shared by the sunset report and the sweep, so the two
 * surfaces can never disagree about when a link moves to a new window.
 */
export function classifySunsetBucket(expiresAt: number | null, now: number): SunsetBucket {
  if (expiresAt === null) return 'never';
  if (expiresAt <= now) return 'expired';
  if (expiresAt <= now + DAY_MS) return 't1';
  if (expiresAt <= now + 7 * DAY_MS) return 't7';
  if (expiresAt <= now + 30 * DAY_MS) return 't30';
  return 'later';
}

export interface SunsetSweepCandidate {
  linkId: string;
  projectId: string;
  ownerMemberId: number;
  expiresAt: number | null;
  bucket: 't30' | 't7' | 't1';
}

/** Active, unrevoked legacy links that currently fall in a notice window. */
export function listSunsetCandidates(db: SqliteDb, now: number): SunsetSweepCandidate[] {
  ensureSunsetNoticeSchema(db);
  const rows = db.prepare(`
    SELECT token_hash, project_id, created_by_member_id, expires_at
      FROM nextore_share_links
     WHERE revoked_at IS NULL
  `).all() as Array<{
    token_hash: string;
    project_id: string;
    created_by_member_id: number;
    expires_at: number | null;
  }>;
  const result: SunsetSweepCandidate[] = [];
  for (const row of rows) {
    const bucket = classifySunsetBucket(row.expires_at, now);
    if (bucket !== 't30' && bucket !== 't7' && bucket !== 't1') continue;
    result.push({
      linkId: row.token_hash,
      projectId: row.project_id,
      ownerMemberId: row.created_by_member_id,
      expiresAt: row.expires_at,
      bucket,
    });
  }
  return result;
}

/** Minimal HTML escape for text interpolated into an email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SunsetSenderDeps {
  moduleBaseUrl: string | null;
  resolveToken: (ownerMemberId: number) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  projectName?: (projectId: string) => string | null;
}

/**
 * Build the sweep sender. 204 means "decided" (sent, disabled or no channel)
 * and is recorded so the same window never nags again; anything else means
 * "not delivered" and stays unrecorded so the next sweep retries.
 */
export function createSunsetSender(deps: SunsetSenderDeps) {
  return async (candidate: SunsetSweepCandidate): Promise<'sent' | 'skipped' | 'failed'> => {
    if (!deps.moduleBaseUrl) return 'failed';
    let token: string | null = null;
    try {
      token = await deps.resolveToken(candidate.ownerMemberId);
    } catch {
      token = null;
    }
    if (!token) return 'failed';

    // The project name is member-supplied text that becomes HTML in the email, so
    // it is escaped here rather than trusted by the module.
    const name = escapeHtml(deps.projectName?.(candidate.projectId) ?? candidate.projectId);
    const expires = candidate.expiresAt ? new Date(candidate.expiresAt).toISOString() : 'never';
    const subject = 'Legacy share link expires soon';
    const body = '<p>The legacy share link for ' + name + ' expires ' + expires
      + '. Create a NexTore link instead.</p>';

    try {
      const fetchImpl = deps.fetchImpl ?? fetch;
      const response = await fetchImpl(
        deps.moduleBaseUrl.replace(/\/+$/, '') + '/api/designer/share-links/sunset-notifications',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', APIkey: token },
          body: JSON.stringify({
            linkId: candidate.linkId,
            bucket: candidate.bucket,
            ownerMemberId: candidate.ownerMemberId,
            subject,
            body,
          }),
        },
      );
      if (response.status === 204) return 'sent';
      deps.log?.('[sunset-notices] module answered ' + response.status);
      return 'failed';
    } catch (error) {
      deps.log?.('[sunset-notices] send failed: '
        + (error instanceof Error ? error.message : String(error)));
      return 'failed';
    }
  };
}
