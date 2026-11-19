import type Database from 'better-sqlite3';

import { ensureNextoreArtifactSchema } from './store.js';

type SqliteDb = Database.Database;

export type BackfillStatus = 'pending' | 'running' | 'done' | 'failed';

export interface BackfillRow {
  projectId: string;
  status: BackfillStatus;
  processed: number;
  lastError: string | null;
  updatedAt: number;
}

export interface BackfillProgress {
  paused: boolean;
  batchSize: number;
  total: number;
  done: number;
  failed: number;
  pending: number;
  updatedAt: number | null;
}

export interface BackfillDeps {
  db: SqliteDb;
  /** Projects eligible for backfill, in a stable order. */
  projectIds: () => readonly string[];
  /** Reconcile one project; null means "cannot reconcile yet". */
  reconcileProject: (projectId: string) => Promise<{ unavailable: boolean; notApplicable?: boolean } | null>;
  batchSize?: number;
  now?: () => number;
}

export interface BackfillBatchResult {
  ran: number;
  done: number;
  failed: number;
  /** Reconciles deferred because the module or session is unavailable. */
  retried: number;
  skipped: boolean;
  remaining: number;
}

const DEFAULT_BATCH_SIZE = 20;

function ensureTables(db: SqliteDb): void {
  ensureNextoreArtifactSchema(db);
}

export function setBackfillPaused(db: SqliteDb, paused: boolean, now = Date.now()): void {
  ensureTables(db);
  db.prepare(`
    INSERT INTO nextore_backfill_settings (id, paused, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at
  `).run(paused ? 1 : 0, now);
}

export function isBackfillPaused(db: SqliteDb): boolean {
  ensureTables(db);
  const row = db.prepare('SELECT paused FROM nextore_backfill_settings WHERE id = 1').get() as
    | { paused?: number }
    | undefined;
  return row?.paused === 1;
}

/** Register every eligible project as pending; done/failed rows keep their state. */
export function seedBackfill(db: SqliteDb, projectIds: readonly string[], now = Date.now()): void {
  ensureTables(db);
  const statement = db.prepare(`
    INSERT INTO nextore_backfill_state (project_id, status, processed, last_error, updated_at)
    VALUES (?, 'pending', 0, NULL, ?)
    ON CONFLICT(project_id) DO NOTHING
  `);
  const run = db.transaction(() => {
    for (const projectId of projectIds) statement.run(projectId, now);
  });
  run();
}

export function listBackfillRows(db: SqliteDb): BackfillRow[] {
  ensureTables(db);
  const rows = db.prepare(`
    SELECT project_id, status, processed, last_error, updated_at
      FROM nextore_backfill_state
     ORDER BY updated_at DESC, project_id ASC
  `).all() as Array<{
    project_id: string;
    status: BackfillStatus;
    processed: number;
    last_error: string | null;
    updated_at: number;
  }>;
  return rows.map((row) => ({
    projectId: row.project_id,
    status: row.status,
    processed: row.processed,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }));
}

export function backfillProgress(db: SqliteDb, batchSize = DEFAULT_BATCH_SIZE): BackfillProgress {
  const rows = listBackfillRows(db);
  const settings = db.prepare('SELECT paused, updated_at FROM nextore_backfill_settings WHERE id = 1')
    .get() as { paused?: number; updated_at?: number } | undefined;
  return {
    paused: settings?.paused === 1,
    batchSize,
    total: rows.length,
    done: rows.filter((row) => row.status === 'done').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending' || row.status === 'running').length,
    updatedAt: settings?.updated_at ?? null,
  };
}

function markRow(
  db: SqliteDb,
  projectId: string,
  status: BackfillStatus,
  processed: number,
  lastError: string | null,
  now: number,
): void {
  db.prepare(`
    UPDATE nextore_backfill_state
       SET status = ?, processed = ?, last_error = ?, updated_at = ?
     WHERE project_id = ?
  `).run(status, processed, lastError, now, projectId);
}

/**
 * Run one bounded backfill batch (P04h).
 *
 * A batch never exceeds `batchSize` projects, never runs while paused, and
 * records every outcome so an operator can resume after a crash. The caller
 * owns the spacing between batches (the daemon schedules it).
 */
export async function runBackfillBatch(deps: BackfillDeps): Promise<BackfillBatchResult> {
  const now = deps.now ?? Date.now;
  const batchSize = Math.max(1, deps.batchSize ?? DEFAULT_BATCH_SIZE);
  seedBackfill(deps.db, deps.projectIds(), now());

  if (isBackfillPaused(deps.db)) {
    const progress = backfillProgress(deps.db, batchSize);
    return { ran: 0, done: 0, failed: 0, retried: 0, skipped: true, remaining: progress.pending };
  }

  const due = listBackfillRows(deps.db)
    .filter((row) => row.status === 'pending')
    .slice(0, batchSize);
  let done = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due) {
    markRow(deps.db, row.projectId, 'running', row.processed, null, now());
    let unavailable = false;
    let notApplicable = false;
    let error: string | null = null;
    try {
      const result = await deps.reconcileProject(row.projectId);
      if (result === null) {
        error = 'reconcile_unavailable';
        unavailable = true;
      } else if (result.unavailable) {
        error = 'nextore_unavailable';
        unavailable = true;
      } else if (result.notApplicable) {
        notApplicable = true;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'reconcile_failed';
    }

    if (error) {
      if (unavailable) retried += 1;
      else failed += 1;
      // An outage is not a project defect: keep it pending so the next batch
      // retries it. A failed reconcile of an individual project is terminal
      // only when the module answered and refused.
      markRow(
        deps.db,
        row.projectId,
        unavailable ? 'pending' : 'failed',
        row.processed,
        error,
        now(),
      );
      continue;
    }
    done += 1;
    const outcome = notApplicable ? 'no_nextore_mapping' : null;
    markRow(deps.db, row.projectId, 'done', row.processed, outcome, now());
  }

  const progress = backfillProgress(deps.db, batchSize);
  return { ran: due.length, done, failed, retried, skipped: false, remaining: progress.pending };
}
