import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isGcCandidateEligible,
  listGcCandidates,
  recordGcCandidates,
} from '../src/nextore-gc.js';

const DAY = 24 * 60 * 60 * 1000;
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => {
  db.close();
});

describe('nextore GC quarantine', () => {
  it('records a local project NexTore no longer knows', () => {
    recordGcCandidates(db, ['p1'], 1_000);
    const [candidate] = listGcCandidates(db, { now: 1_000 });
    expect(candidate).toMatchObject({ projectId: 'p1', reason: 'not_in_nextore', firstSeenAt: 1_000 });
  });

  it('keeps the original first-seen time and refreshes last-seen', () => {
    recordGcCandidates(db, ['p1'], 1_000);
    recordGcCandidates(db, ['p1'], 5_000);
    const [candidate] = listGcCandidates(db, { now: 5_000 });
    expect(candidate?.firstSeenAt).toBe(1_000);
    expect(candidate?.lastSeenAt).toBe(5_000);
  });

  it('drops a project that is back in NexTore', () => {
    recordGcCandidates(db, ['p1', 'p2'], 1_000);
    recordGcCandidates(db, ['p2'], 2_000);
    expect(listGcCandidates(db, { now: 2_000 }).map((c) => c.projectId)).toEqual(['p2']);
  });

  it('reports eligibility only after the grace period', () => {
    recordGcCandidates(db, ['p1'], 0);
    const early = listGcCandidates(db, { now: 13 * DAY });
    expect(early[0]?.eligible).toBe(false);
    expect(isGcCandidateEligible(early[0], 13 * DAY)).toBe(false);

    const late = listGcCandidates(db, { now: 14 * DAY });
    expect(late[0]?.eligible).toBe(true);
    expect(isGcCandidateEligible(late[0], 14 * DAY)).toBe(true);
  });

  it('honours a custom grace window', () => {
    recordGcCandidates(db, ['p1'], 0);
    const [candidate] = listGcCandidates(db, { now: 2_000, graceMs: 1_000 });
    expect(candidate?.eligible).toBe(true);
  });

  it('ignores empty and non-string ids', () => {
    recordGcCandidates(db, ['', 'p1'], 1_000);
    expect(listGcCandidates(db, { now: 1_000 }).map((c) => c.projectId)).toEqual(['p1']);
  });
});
