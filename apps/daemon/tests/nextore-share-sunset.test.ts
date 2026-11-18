import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runShareSunsetSweep, type SunsetCandidate } from '../src/nextore/share/sunset-notices.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => {
  db.close();
});

function link(overrides: Partial<SunsetCandidate> = {}): SunsetCandidate {
  return {
    linkId: 'link-1',
    projectId: 'p1',
    createdByMemberId: 7,
    expiresAt: 1,
    bucket: 't30',
    ...overrides,
  };
}

function sweep(candidates: SunsetCandidate[], send: (c: SunsetCandidate, b: string) => Promise<'sent' | 'skipped' | 'failed'>) {
  return runShareSunsetSweep({ db, listCandidates: () => candidates, send: send as never, now: () => 1_000 });
}

describe('P04h share sunset sweep', () => {
  it('sends once per link and bucket, even when run twice the same day', async () => {
    const send = vi.fn(async () => 'sent' as const);

    const first = await sweep([link()], send);
    const second = await sweep([link()], send);

    expect(first.sent).toBe(1);
    expect(second).toMatchObject({ sent: 0, skippedDuplicate: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends again when the bucket escalates', async () => {
    const send = vi.fn(async () => 'sent' as const);

    await sweep([link({ bucket: 't30' })], send);
    await sweep([link({ bucket: 't7' })], send);
    await sweep([link({ bucket: 't1' })], send);
    await sweep([link({ bucket: 't1' })], send);

    expect(send).toHaveBeenCalledTimes(3);
  });

  it('never notifies an expired link', async () => {
    const send = vi.fn(async () => 'sent' as const);

    const result = await sweep([link({ bucket: 'expired' })], send);

    expect(result).toMatchObject({ sent: 0, skippedNotEligible: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when the feature is off', async () => {
    const send = vi.fn(async () => 'sent' as const);

    const result = await sweep([], send);

    expect(result.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not record a failed delivery, so the next sweep retries', async () => {
    const failing = vi.fn(async () => 'failed' as const);

    const first = await sweep([link()], failing);
    expect(first).toMatchObject({ sent: 0, failed: 1 });

    const retry = vi.fn(async () => 'sent' as const);
    const second = await sweep([link()], retry);
    expect(second.sent).toBe(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('treats skipped as decided (no retry)', async () => {
    const skip = vi.fn(async () => 'skipped' as const);
    await sweep([link()], skip);

    const again = await sweep([link()], vi.fn(async () => 'sent' as const));
    expect(again).toMatchObject({ sent: 0, skippedDuplicate: 1 });
  });
});
