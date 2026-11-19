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

  it('does not record anything when the module endpoint 404s', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const { createSunsetSender } = await import('../src/nextore/share/sunset-notices.js');
    const sender = createSunsetSender({
      moduleBaseUrl: 'https://module.test',
      resolveToken: async () => 'token',
      fetchImpl,
    });

    const result = await sweep([link({ bucket: 't7' })], (c) => sender({
      linkId: c.linkId,
      projectId: c.projectId,
      ownerMemberId: c.createdByMemberId,
      expiresAt: c.expiresAt,
      bucket: c.bucket as 't30' | 't7' | 't1',
    }));

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM nextore_share_sunset_notices').get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('escapes a member-supplied project name in the notice body', async () => {
    let body = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { createSunsetSender } = await import('../src/nextore/share/sunset-notices.js');
    const sender = createSunsetSender({
      moduleBaseUrl: 'https://module.test',
      resolveToken: async () => 'token',
      fetchImpl,
      projectName: () => '<img src=x onerror=alert(1)>',
    });

    await sender({
      linkId: 'link-9',
      projectId: 'p1',
      ownerMemberId: 7,
      expiresAt: null,
      bucket: 't7',
    });

    // The module renders this body as HTML; a project name must not become markup.
    expect(body).not.toContain('<img');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('records a 204 decision so the same window is never retried', async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const { createSunsetSender } = await import('../src/nextore/share/sunset-notices.js');
    const sender = createSunsetSender({
      moduleBaseUrl: 'https://module.test',
      resolveToken: async () => 'token',
      fetchImpl,
    });
    const call = (c: { linkId: string; projectId: string; createdByMemberId: number; expiresAt: number | null; bucket: string }) => sender({
      linkId: c.linkId,
      projectId: c.projectId,
      ownerMemberId: c.createdByMemberId,
      expiresAt: c.expiresAt,
      bucket: c.bucket as 't30' | 't7' | 't1',
    });

    await sweep([link({ bucket: 't1' })], call as never);
    const again = await sweep([link({ bucket: 't1' })], call as never);

    expect(again).toMatchObject({ sent: 0, skippedDuplicate: 1 });
  });

  it('classifies buckets with the shared rule', async () => {
    const { classifySunsetBucket } = await import('../src/nextore/share/sunset-notices.js');
    const now = Date.UTC(2026, 0, 1);
    const day = 24 * 60 * 60 * 1000;
    expect(classifySunsetBucket(null, now)).toBe('never');
    expect(classifySunsetBucket(now - 1, now)).toBe('expired');
    expect(classifySunsetBucket(now + day, now)).toBe('t1');
    expect(classifySunsetBucket(now + 3 * day, now)).toBe('t7');
    expect(classifySunsetBucket(now + 20 * day, now)).toBe('t30');
    expect(classifySunsetBucket(now + 60 * day, now)).toBe('later');
  });

  it('treats skipped as decided (no retry)', async () => {
    const skip = vi.fn(async () => 'skipped' as const);
    await sweep([link()], skip);

    const again = await sweep([link()], vi.fn(async () => 'sent' as const));
    expect(again).toMatchObject({ sent: 0, skippedDuplicate: 1 });
  });
});
