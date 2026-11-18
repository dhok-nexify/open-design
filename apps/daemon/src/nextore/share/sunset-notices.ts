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
