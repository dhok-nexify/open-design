import { describe, expect, it } from 'vitest';

import { createProjectRunLock } from '../src/project-run-lock.js';

const active = () => true;
const inactive = () => false;

describe('createProjectRunLock', () => {
  it('acquires a free project', () => {
    const lock = createProjectRunLock();
    expect(lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active)).toEqual({ ok: true });
    expect(lock.holder('p1')).toMatchObject({ runId: 'r1', memberId: 7 });
  });

  it('rejects a second run while the first is active and reports the holder', () => {
    const lock = createProjectRunLock();
    lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active);
    const second = lock.tryAcquire('p1', { runId: 'r2', memberId: 8 }, active);
    expect(second).toEqual({ ok: false, holder: expect.objectContaining({ runId: 'r1', memberId: 7 }) });
    expect(lock.holder('p1')?.runId).toBe('r1');
  });

  it('treats re-acquiring the same run as a no-op success', () => {
    const lock = createProjectRunLock();
    lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active);
    expect(lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active)).toEqual({ ok: true });
  });

  it('takes over when the holder run is terminal or missing', () => {
    const lock = createProjectRunLock();
    lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active);
    expect(lock.tryAcquire('p1', { runId: 'r2', memberId: 8 }, inactive)).toEqual({ ok: true });
    expect(lock.holder('p1')?.runId).toBe('r2');
  });

  it('takes over an expired holder even if its run still looks active', () => {
    let now = 1_000;
    const lock = createProjectRunLock({ ttlMs: 100, now: () => now });
    lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active);
    now += 101;
    expect(lock.tryAcquire('p1', { runId: 'r2', memberId: 8 }, active)).toEqual({ ok: true });
    expect(lock.holder('p1')?.runId).toBe('r2');
  });

  it('does not let another run release the lock', () => {
    const lock = createProjectRunLock();
    lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active);
    lock.release('p1', 'r2');
    expect(lock.holder('p1')?.runId).toBe('r1');
    lock.release('p1', 'r1');
    expect(lock.holder('p1')).toBeNull();
  });

  it('keeps projects independent and can be cleared', () => {
    const lock = createProjectRunLock();
    lock.tryAcquire('p1', { runId: 'r1', memberId: 7 }, active);
    expect(lock.tryAcquire('p2', { runId: 'r2', memberId: 8 }, active)).toEqual({ ok: true });
    expect(lock.size()).toBe(2);
    lock.clear();
    expect(lock.size()).toBe(0);
  });
});
