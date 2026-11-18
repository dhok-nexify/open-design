import type Database from 'better-sqlite3';
import type { Express, Response } from 'express';

import type { NextoreArtifactRuntime } from './runtime.js';
import {
  backfillProgress,
  isBackfillPaused,
  runBackfillBatch,
  setBackfillPaused,
} from './backfill.js';

type SqliteDb = Database.Database;

export interface RegisterNextoreBackfillRoutesDeps {
  runtime: NextoreArtifactRuntime | null;
  db: SqliteDb;
  /** Projects the daemon can consider, in a stable order. */
  listProjectIds: () => readonly string[];
  now?: () => number;
}

function sessionMemberId(res: Response): number | null {
  const session = (res.locals as { nextoreSession?: { memberId?: unknown } }).nextoreSession;
  const id = session?.memberId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * P04h backfill control plane.
 *
 * Progress and pause state are durable so a restart neither replays finished
 * projects nor silently resumes a paused rollout. The caller must hold a
 * NexTore session; each project's reconcile still goes through that member's
 * own ACL, so this surface cannot widen anyone's access.
 */
export function registerNextoreBackfillRoutes(
  app: Express,
  deps: RegisterNextoreBackfillRoutesDeps,
): void {
  const guard = (res: Response): boolean => {
    if (!deps.runtime) {
      res.status(404).json({ error: 'feature_disabled' });
      return false;
    }
    if (!sessionMemberId(res)) {
      res.status(401).json({ error: 'SESSION_REQUIRED', message: 'A NexTore session is required.' });
      return false;
    }
    return true;
  };

  app.get('/api/nextore/artifacts/backfill', (req, res) => {
    if (!guard(res)) return;
    const batchSize = Number(req.query.batchSize);
    res.json(backfillProgress(deps.db, Number.isFinite(batchSize) && batchSize > 0 ? batchSize : undefined));
  });

  app.post('/api/nextore/artifacts/backfill', async (req, res) => {
    if (!guard(res)) return;
    const runtime = deps.runtime!;
    const now = deps.now ?? Date.now;
    const body = req.body && typeof req.body === 'object'
      ? req.body as { action?: unknown; batchSize?: unknown }
      : {};
    const action = typeof body.action === 'string' ? body.action : 'start';
    const requestedSize = Number(body.batchSize);
    const batchSize = Number.isFinite(requestedSize) && requestedSize > 0
      ? Math.min(Math.floor(requestedSize), 100)
      : 20;

    if (action === 'pause') {
      setBackfillPaused(deps.db, true, now());
      res.json({ action, ...backfillProgress(deps.db, batchSize) });
      return;
    }
    if (action === 'resume') {
      setBackfillPaused(deps.db, false, now());
      res.json({ action, ...backfillProgress(deps.db, batchSize), pausedBefore: true });
      return;
    }
    if (action !== 'start') {
      res.status(400).json({ error: 'invalid_action', message: 'action must be start, pause or resume' });
      return;
    }
    // An explicit start clears a pause; otherwise a paused rollout could never
    // be started again without a second call.
    if (isBackfillPaused(deps.db)) setBackfillPaused(deps.db, false, now());
    const batch = await runBackfillBatch({
      db: deps.db,
      projectIds: deps.listProjectIds,
      reconcileProject: (projectId) => runtime.reconcileProject(projectId),
      batchSize,
      now,
    });
    res.json({ action, ...batch, progress: backfillProgress(deps.db, batchSize) });
  });
}
