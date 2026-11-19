import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateNextoreDatabase } from '../src/nextore/db.js';
import {
  backfillProgress,
  isBackfillPaused,
  listBackfillRows,
  runBackfillBatch,
  setBackfillPaused,
} from '../src/nextore/artifacts/backfill.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
  `);
  migrateNextoreDatabase(db);
});

afterEach(() => {
  db.close();
});

function deps(reconcileProject: (projectId: string) => Promise<unknown>, batchSize = 2) {
  return {
    db,
    projectIds: () => ['p1', 'p2', 'p3'],
    reconcileProject: reconcileProject as (
      projectId: string,
    ) => Promise<{ unavailable: boolean } | null>,
    batchSize,
    now: () => 1_000,
  };
}

describe('runBackfillBatch', () => {
  it('processes only one bounded batch at a time', async () => {
    const seen: string[] = [];
    const result = await runBackfillBatch(deps(async (projectId) => {
      seen.push(projectId);
      return { unavailable: false };
    }));

    expect(result).toMatchObject({ ran: 2, done: 2, failed: 0, skipped: false, remaining: 1 });
    expect(seen).toEqual(['p1', 'p2']);
    expect(listBackfillRows(db).map((row) => row.status)).toEqual(['done', 'done', 'pending']);
  });

  it('finishes a project that has nothing to migrate instead of retrying it', async () => {
    // A project that was never linked to NexTore can never become reconcilable.
    const result = await runBackfillBatch(deps(async (projectId) => (
      projectId === 'p1'
        ? { unavailable: false, notApplicable: true }
        : { unavailable: false }
    )));

    expect(result).toMatchObject({ ran: 2, done: 2, failed: 0, retried: 0 });
    const rows = listBackfillRows(db);
    expect(rows.find((row) => row.projectId === 'p1')?.lastError).toBe('no_nextore_mapping');
    expect(rows.every((row) => row.status !== 'pending' || row.projectId === 'p3')).toBe(true);
  });

  it('resumes where it stopped on the next batch', async () => {
    await runBackfillBatch(deps(async () => ({ unavailable: false })));
    const second = await runBackfillBatch(deps(async () => ({ unavailable: false })));

    expect(second.ran).toBe(1);
    expect(backfillProgress(db)).toMatchObject({ total: 3, done: 3, pending: 0 });
  });

  it('does nothing while paused', async () => {
    const reconcile = vi.fn(async () => ({ unavailable: false }));
    setBackfillPaused(db, true, 1_000);

    const result = await runBackfillBatch(deps(reconcile));

    expect(result).toMatchObject({ ran: 0, skipped: true, remaining: 3 });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('keeps an unreachable project pending instead of failing it', async () => {
    const result = await runBackfillBatch(deps(async () => ({ unavailable: true }), 3));

    expect(result).toMatchObject({ failed: 0, retried: 3, remaining: 3 });
    expect(backfillProgress(db)).toMatchObject({ pending: 3, failed: 0 });
  });

  it('records a reconcile that answered with an error as failed', async () => {
    const result = await runBackfillBatch(deps(async () => {
      throw new Error('acl denied');
    }, 3));

    expect(result.failed).toBe(3);
    expect(listBackfillRows(db).every((row) => row.status === 'failed')).toBe(true);
  });

  it('keeps a project without a member or mapping out of the done count', async () => {
    const result = await runBackfillBatch(deps(async () => null, 3));

    expect(result).toMatchObject({ done: 0, retried: 3 });
    expect(backfillProgress(db).pending).toBe(3);
  });

  it('resumes from a pause', () => {
    setBackfillPaused(db, true, 1_000);
    expect(isBackfillPaused(db)).toBe(true);
    setBackfillPaused(db, false, 2_000);
    expect(isBackfillPaused(db)).toBe(false);
  });
});
