import type Database from 'better-sqlite3';

type SqliteDb = Database.Database;

export interface GcCandidate {
  projectId: string;
  reason: 'not_in_nextore';
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface GcCandidateView extends GcCandidate {
  eligibleAt: number;
  eligible: boolean;
}

const DEFAULT_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Quarantine for local projects NexTore no longer knows about (NXD-D08).
 *
 * Designer holds the only copy of a project's content, so a mismatch is never
 * deleted automatically: the project stays on disk, disappears from the UI
 * after the grace period, and is only removed by an explicit, confirmed purge.
 * Recording is idempotent so it can run on every listing read.
 */
export function ensureGcTable(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nextore_gc_candidates (
      project_id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nextore_gc_last_seen
      ON nextore_gc_candidates(last_seen_at);
  `);
}

/**
 * Reconciles the candidate set with the current mismatch list. Projects that
 * are back in NexTore are dropped; new mismatches start their grace window.
 */
export function recordGcCandidates(
  db: SqliteDb,
  orphanedProjectIds: readonly string[],
  now: number = Date.now(),
): void {
  ensureGcTable(db);
  const current = new Set(orphanedProjectIds.filter((id) => typeof id === 'string' && id));
  const existing = db
    .prepare(`SELECT project_id AS projectId FROM nextore_gc_candidates`)
    .all() as Array<{ projectId: string }>;

  const upsert = db.prepare(`
    INSERT INTO nextore_gc_candidates (project_id, reason, first_seen_at, last_seen_at)
    VALUES (?, 'not_in_nextore', ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `);
  const remove = db.prepare(`DELETE FROM nextore_gc_candidates WHERE project_id = ?`);

  db.transaction(() => {
    for (const id of current) upsert.run(id, now, now);
    for (const row of existing) {
      if (!current.has(row.projectId)) remove.run(row.projectId);
    }
  })();
}

export function listGcCandidates(
  db: SqliteDb,
  options: { now?: number; graceMs?: number } = {},
): GcCandidateView[] {
  ensureGcTable(db);
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const rows = db
    .prepare(
      `SELECT project_id AS projectId, reason, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
         FROM nextore_gc_candidates
        ORDER BY first_seen_at ASC`,
    )
    .all() as GcCandidate[];
  return rows.map((row) => {
    const eligibleAt = row.firstSeenAt + graceMs;
    return { ...row, eligibleAt, eligible: now >= eligibleAt };
  });
}

/**
 * Whether a confirmed purge may run. Callers must re-check this immediately
 * before deleting: the UI's eligibility snapshot can be stale.
 */
export function isGcCandidateEligible(
  candidate: GcCandidateView | undefined,
  now: number = Date.now(),
): boolean {
  return Boolean(candidate && now >= candidate.eligibleAt);
}
